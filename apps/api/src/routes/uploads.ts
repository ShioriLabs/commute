import { Hono } from 'hono'
import { Bindings } from 'app'
import { wibIsoString } from 'utils/fare'
import { BadRequest, LengthRequired, PayloadTooLarge, UnsupportedMediaType } from 'utils/response'

/*
 * Anonymous trip-log uploads from the Android app's trip mode.
 *
 * There is no credential on purpose. The app has no accounts, and any secret
 * shipped inside the APK can be pulled back out of it, so a baked-in key would
 * only look like security. What keeps this safe instead:
 *
 * - The server picks the object key. A client cannot name, overwrite, or
 *   traverse to anything.
 * - The body is capped at MAX_TRIP_LOG_BYTES, counted while streaming, so a
 *   Content-Length that lies buys nothing.
 * - The body must start with a zstd frame. Anything else is refused before it
 *   reaches R2.
 * - rateLimit('UPLOAD') bounds each IP, and it ignores the Origin exemption the
 *   read routes have (see middleware/rate-limit.ts).
 * - CORS still allows only GET, so a third-party page cannot get past the
 *   preflight and turn its visitors' browsers into uploaders.
 *
 * Nothing that identifies the uploader is stored: no IP, no User-Agent, no
 * country. requestLog() never logs an IP, and this handler never logs the key.
 *
 * The NDJSON inside is not checked here. Workers' DecompressionStream has no
 * zstd, so content gets validated at analysis time, the same as ward's archives.
 */
const app = new Hono<{ Bindings: Bindings }>()

/** A GPS trace for one trip compresses to well under this. */
export const MAX_TRIP_LOG_BYTES = 1_048_576

/** Every zstd frame starts with this (RFC 8878 §3.1.1). */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

const APP_VERSION_PATTERN = /^[\w.+-]{1,32}$/

/** `trips/YYYY/MM/DD/<id>.ndjson.zst`, dated by the Jakarta wall clock. */
export function tripLogKey(date: Date, id: string): string {
  const [y, m, d] = wibIsoString(date).slice(0, 10).split('-')
  return `trips/${y}/${m}/${d}/${id}.ndjson.zst`
}

/**
 * Read at most `limit` bytes. Returns null once the stream goes past it, and
 * cancels the rest rather than buffering it.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

app.post('/trips', async (c) => {
  /*
   * The cap only binds when reading is refused up front, so a body with no
   * declared length is refused rather than read speculatively.
   */
  const declared = c.req.header('Content-Length')
  if (declared === undefined) return c.json(LengthRequired(), 411)
  if (!(Number(declared) <= MAX_TRIP_LOG_BYTES)) return c.json(PayloadTooLarge(), 413)

  const bytes = await readCapped(c.req.raw.body, MAX_TRIP_LOG_BYTES)
  if (!bytes) return c.json(PayloadTooLarge(), 413)
  if (bytes.byteLength === 0) return c.json(BadRequest('EMPTY_BODY', 'Request body is empty'), 400)
  if (bytes.byteLength < ZSTD_MAGIC.length || ZSTD_MAGIC.some((b, i) => bytes[i] !== b)) {
    return c.json(UnsupportedMediaType(), 415)
  }

  const now = new Date()
  const id = crypto.randomUUID()
  const sha256 = await crypto.subtle.digest('SHA-256', bytes)

  const appVersion = c.req.header('X-App-Version')
  const customMetadata: Record<string, string> = { receivedAt: wibIsoString(now) }
  if (appVersion && APP_VERSION_PATTERN.test(appVersion)) customMetadata.appVersion = appVersion

  // `sha256` makes R2 reject the write if the bytes it stored differ.
  await c.env.TRIP_LOGS.put(tripLogKey(now, id), bytes, {
    httpMetadata: { contentType: 'application/zstd' },
    sha256,
    customMetadata
  })

  return c.json({ status: 201, data: { id } }, 201)
})

export default app
