import { describe, expect, it } from 'vitest'

import app from 'app'
import type { Bindings } from 'app'

import { MAX_TRIP_LOG_BYTES, TRIP_LOG_RETENTION_DAYS, tripLogKey, UPLOADS_FLAG_KEY } from './uploads'

/*
 * The upload is anonymous, so its validation is the whole of its security.
 * These pin the boundaries a client could push on: who picks the key, how big
 * a body can get (declared or not), what a body must look like, and what about
 * the uploader ends up stored.
 */

interface Put {
  key: string
  bytes: Uint8Array
  options: R2PutOptions
}

const fakeBucket = (puts: Put[] = []) => ({
  put: async (key: string, value: Uint8Array, options: R2PutOptions) => {
    puts.push({ key, bytes: value, options })
    return {} as R2Object
  }
}) as unknown as R2Bucket

/** KV holding only the uploads flag; `null` means the key is absent. */
const fakeKV = (flag: string | null) => ({
  get: async (key: string) => (key === UPLOADS_FLAG_KEY ? flag : null)
}) as unknown as KVNamespace

const zstd = (size = 64) => {
  const bytes = new Uint8Array(size)
  bytes.set([0x28, 0xb5, 0x2f, 0xfd])
  return bytes
}

const upload = (body: BodyInit | null, headers: Record<string, string> = {}, puts: Put[] = [], flag: string | null = 'open') =>
  app.fetch(
    // `duplex` is what Node requires to send a stream body; Workers ignore it.
    new Request('http://localhost/uploads/trips', { method: 'POST', body, headers, duplex: 'half' } as RequestInit),
    { TRIP_LOGS: fakeBucket(puts), KV: fakeKV(flag) } as unknown as Bindings
  )

const withLength = (bytes: Uint8Array, extra: Record<string, string> = {}) => ({
  'Content-Length': String(bytes.byteLength),
  'Content-Type': 'application/zstd',
  ...extra
})

/** A body whose length is only known by reading it, like a chunked upload. */
const streamOf = (bytes: Uint8Array, chunk = 64 * 1024) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (let i = 0; i < bytes.byteLength; i += chunk) controller.enqueue(bytes.slice(i, i + chunk))
    controller.close()
  }
})

describe('POST /uploads/trips', () => {
  /*
   * Closed is the default. A fresh environment, or one where the key was
   * deleted, must refuse before reading a byte.
   */
  it.each([
    ['the flag is absent', null],
    ['the flag is anything but open', 'closed'],
    ['the flag is a near miss', 'Open']
  ])('refuses with 503 when %s', async (_, flag) => {
    const puts: Put[] = []
    const body = zstd()
    const res = await upload(body, withLength(body), puts, flag)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'UPLOADS_CLOSED' } })
    expect(puts).toHaveLength(0)
  })

  it('stores the bytes under a server-chosen dated key and returns its id', async () => {
    const puts: Put[] = []
    const body = zstd()
    const res = await upload(body, withLength(body), puts)

    expect(res.status).toBe(201)
    const { data } = await res.json() as { data: { id: string, expiresAt: string } }
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/)

    expect(puts).toHaveLength(1)
    expect(puts[0]!.key).toMatch(new RegExp(`^trips/\\d{4}/\\d{2}/\\d{2}/${data.id}\\.ndjson\\.zst$`))
    expect(puts[0]!.bytes).toEqual(body)
    expect(puts[0]!.options.sha256).toBeDefined()
    expect(puts[0]!.options.httpMetadata).toEqual({ contentType: 'application/zstd' })

    const receivedAt = Date.parse(puts[0]!.options.customMetadata!.receivedAt!)
    expect(Date.parse(data.expiresAt) - receivedAt).toBe(TRIP_LOG_RETENTION_DAYS * 86_400_000)
  })

  it('stores nothing that identifies the uploader', async () => {
    const puts: Put[] = []
    const body = zstd()
    await upload(body, withLength(body, {
      'CF-Connecting-IP': '203.0.113.7',
      'User-Agent': 'okhttp/4.12.0',
      'X-App-Version': '1.4.0+52'
    }), puts)

    expect(Object.keys(puts[0]!.options.customMetadata ?? {}).sort()).toEqual(['appVersion', 'receivedAt'])
    expect(JSON.stringify(puts[0]!.options)).not.toContain('203.0.113.7')
    expect(JSON.stringify(puts[0]!.options)).not.toContain('okhttp')
  })

  it('drops an app version that is not a plain version string', async () => {
    const puts: Put[] = []
    const body = zstd()
    await upload(body, withLength(body, { 'X-App-Version': 'x'.repeat(200) }), puts)
    expect(puts[0]!.options.customMetadata).not.toHaveProperty('appVersion')
  })

  it('refuses a body with no declared length', async () => {
    const puts: Put[] = []
    const res = await upload(streamOf(zstd()), {}, puts)
    expect(res.status).toBe(411)
    expect(puts).toHaveLength(0)
  })

  it('refuses an oversized declared length before reading', async () => {
    const puts: Put[] = []
    const res = await upload(zstd(), { 'Content-Length': String(MAX_TRIP_LOG_BYTES + 1) }, puts)
    expect(res.status).toBe(413)
    expect(puts).toHaveLength(0)
  })

  it('refuses a body that runs past the cap while under-declaring its length', async () => {
    const puts: Put[] = []
    const res = await upload(streamOf(zstd(MAX_TRIP_LOG_BYTES + 1)), { 'Content-Length': '64' }, puts)
    expect(res.status).toBe(413)
    expect(puts).toHaveLength(0)
  })

  it('accepts a body exactly at the cap', async () => {
    const body = zstd(MAX_TRIP_LOG_BYTES)
    const res = await upload(body, withLength(body))
    expect(res.status).toBe(201)
  })

  it.each([
    ['gzip', new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00])],
    ['plain NDJSON', new TextEncoder().encode('{"k":"start"}\n')],
    ['a truncated magic', new Uint8Array([0x28, 0xb5])]
  ])('refuses %s with 415', async (_, body) => {
    const puts: Put[] = []
    const res = await upload(body, withLength(body), puts)
    expect(res.status).toBe(415)
    expect(puts).toHaveLength(0)
  })

  it('refuses an empty body', async () => {
    const res = await upload(new Uint8Array(0), { 'Content-Length': '0' })
    expect(res.status).toBe(400)
  })

  it('has no GET', async () => {
    const res = await app.request('/uploads/trips', {}, { TRIP_LOGS: fakeBucket(), KV: fakeKV('open') })
    expect(res.status).toBe(404)
  })
})

describe('tripLogKey', () => {
  // 18:30 UTC is 01:30 the next day in Jakarta, and the archive is dated by Jakarta.
  it('dates the key by the Jakarta wall clock', () => {
    expect(tripLogKey(new Date('2026-10-08T18:30:00Z'), 'abc')).toBe('trips/2026/10/09/abc.ndjson.zst')
  })
})
