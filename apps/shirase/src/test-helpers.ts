import { zxyToTileId } from 'pmtiles'

/*
 * Test fixtures: a real (tiny) PMTiles v3 archive and an in-memory R2 bucket,
 * so the directory walk in archive.ts runs against the actual format rather
 * than a mock of it.
 */

export interface FixtureTile { z: number, x: number, y: number, data: Uint8Array }

const writeVarint = (out: number[], value: number): void => {
  let v = value
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

/*
 * Single root directory, internal compression None (1), tile compression Gzip
 * (2) as Protomaps builds declare. Tile bytes are stored as given and never
 * decompressed by shirase, so they need not be real gzip.
 */
export function buildArchive(tiles: FixtureTile[], options: { minZoom?: number, maxZoom?: number, metadata?: object } = {}): Uint8Array {
  const entries = tiles
    .map(t => ({ tileId: zxyToTileId(t.z, t.x, t.y), data: t.data }))
    .sort((a, b) => a.tileId - b.tileId)

  const dir: number[] = []
  writeVarint(dir, entries.length)
  let last = 0
  for (const e of entries) {
    writeVarint(dir, e.tileId - last)
    last = e.tileId
  }
  for (let i = 0; i < entries.length; i++) writeVarint(dir, 1)
  for (const e of entries) writeVarint(dir, e.data.length)
  // Offset 0 means "right after the previous tile", the format's run-on form.
  entries.forEach((_, i) => writeVarint(dir, i === 0 ? 1 : 0))

  const metadata = new TextEncoder().encode(JSON.stringify(options.metadata ?? {
    vector_layers: [{ id: 'roads', fields: {} }],
    attribution: '© OpenStreetMap'
  }))
  const tileData = new Uint8Array(entries.reduce((n, e) => n + e.data.length, 0))
  let at = 0
  for (const e of entries) {
    tileData.set(e.data, at)
    at += e.data.length
  }

  const HEADER = 127
  const rootOffset = HEADER
  const metadataOffset = rootOffset + dir.length
  const leafOffset = metadataOffset + metadata.length
  const tileOffset = leafOffset

  const out = new Uint8Array(tileOffset + tileData.length)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode('PMTiles'), 0)
  view.setUint8(7, 3)
  const u64 = (offset: number, value: number) => {
    view.setUint32(offset, value % 2 ** 32, true)
    view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true)
  }
  u64(8, rootOffset)
  u64(16, dir.length)
  u64(24, metadataOffset)
  u64(32, metadata.length)
  u64(40, leafOffset)
  u64(48, 0)
  u64(56, tileOffset)
  u64(64, tileData.length)
  u64(72, entries.length)
  u64(80, entries.length)
  u64(88, entries.length)
  view.setUint8(96, 1) // clustered
  view.setUint8(97, 1) // internal compression: none
  view.setUint8(98, 2) // tile compression: gzip
  view.setUint8(99, 1) // tile type: mvt
  view.setUint8(100, options.minZoom ?? 0)
  view.setUint8(101, options.maxZoom ?? 15)
  view.setInt32(102, 105.9e7, true)
  view.setInt32(106, -6.8e7, true)
  view.setInt32(110, 107.3e7, true)
  view.setInt32(114, -5.85e7, true)
  view.setUint8(118, 10)
  view.setInt32(119, 106.8e7, true)
  view.setInt32(123, -6.2e7, true)

  out.set(dir, rootOffset)
  out.set(metadata, metadataOffset)
  out.set(tileData, tileOffset)
  return out
}

interface StoredObject { bytes: Uint8Array, etag: string }

/** The slice of R2Bucket shirase uses: ranged and whole-object gets. */
export class FakeBucket {
  readonly objects = new Map<string, StoredObject>()
  gets = 0
  private version = 0

  put(key: string, bytes: Uint8Array): void {
    this.objects.set(key, { bytes, etag: `v${++this.version}` })
  }

  async get(key: string, options?: { range?: { offset: number, length: number } }) {
    this.gets++
    const stored = this.objects.get(key)
    if (!stored) return null
    const { offset = 0, length = stored.bytes.length - offset } = options?.range ?? {}
    const slice = stored.bytes.slice(offset, offset + length)
    return {
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      body: new Blob([slice]).stream(),
      arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
    }
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket
  }
}

/** caches.default, in memory, keyed by URL. */
export class FakeCache {
  readonly store = new Map<string, Response>()

  async match(request: Request): Promise<Response | undefined> {
    return this.store.get(request.url)?.clone()
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response)
  }
}

export function fakeExecutionContext(): ExecutionContext & { settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = []
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p)
    },
    passThroughOnException: () => {},
    props: {},
    settle: async () => {
      await Promise.all(pending)
    }
  } as unknown as ExecutionContext & { settle: () => Promise<void> }
}
