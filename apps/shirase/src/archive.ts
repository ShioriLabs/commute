import { Compression, EtagMismatch, findTile, PMTiles, SharedPromiseCache, zxyToTileId, type Header, type RangeResponse, type Source } from 'pmtiles'

/*
 * A PMTiles archive in R2, read with ranged gets.
 *
 * The `pmtiles` package does the format work (header, directories, the
 * directory cache), but its getZxy hands back DECOMPRESSED tile bytes. The
 * archive stores each tile already gzipped, which is exactly what we want to
 * send, so getRawTile walks the directories itself with the package's own
 * exported pieces and returns the stored bytes untouched. Decompressing to
 * have the edge recompress every tile would be pure waste.
 */

export class ArchiveNotFound extends Error {}

export class R2Source implements Source {
  constructor(private readonly bucket: R2Bucket, private readonly key: string) {}

  getKey(): string {
    return this.key
  }

  /*
   * `etag` is the one the header was read with. A different one means the
   * object was replaced under a live isolate; EtagMismatch makes the caller
   * drop its cached header and directories and read again. Archives are
   * versioned by filename, so this is a guard, not the refresh path.
   */
  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const object = await this.bucket.get(this.key, { range: { offset, length } })
    if (!object) throw new ArchiveNotFound(this.key)
    if (etag && object.etag !== etag) throw new EtagMismatch(`${this.key} changed under a cached header`)
    return { data: await object.arrayBuffer(), etag: object.etag }
  }
}

export interface Archive {
  source: R2Source
  cache: SharedPromiseCache
  pmtiles: PMTiles
}

/*
 * One archive per tileset per isolate, so the header and directory cache
 * persist across requests instead of costing two extra R2 reads per tile.
 */
const archives = new Map<string, Archive>()

export function openArchive(bucket: R2Bucket, tileset: string): Archive {
  const key = `${tileset}.pmtiles`
  const existing = archives.get(key)
  if (existing) return existing
  const source = new R2Source(bucket, key)
  const cache = new SharedPromiseCache()
  const archive = { source, cache, pmtiles: new PMTiles(source, cache) }
  archives.set(key, archive)
  return archive
}

/*
 * Forget one archive, so the next request opens it afresh. Called when the
 * object turned out to be missing: the pmtiles cache keeps the failed header
 * read, so without this an archive asked for before it was uploaded stays a
 * 404 for the life of the isolate (seen with jp-roads-v2 locally).
 */
export function closeArchive(tileset: string): void {
  archives.delete(`${tileset}.pmtiles`)
}

/** For tests: forget every open archive. */
export function closeArchives(): void {
  archives.clear()
}

export interface RawTile {
  data: ArrayBuffer
  compression: Compression
}

/*
 * The stored bytes of one tile, or null when the archive has no tile there
 * (open sea, outside the extract). Throws RangeError for a z/x/y that is not
 * a tile at all, so the route can answer 404 rather than 204.
 *
 * Mirrors PMTiles.getZxyAttempt, minus the final decompress.
 */
export async function getRawTile(archive: Archive, z: number, x: number, y: number): Promise<{ header: Header, tile: RawTile | null }> {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new RangeError(`zoom ${z}`)
  const size = 2 ** z
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) {
    throw new RangeError(`tile ${z}/${x}/${y}`)
  }

  try {
    return await attempt(archive, z, x, y)
  } catch (error) {
    if (!(error instanceof EtagMismatch)) throw error
    await archive.cache.invalidate(archive.source)
    return attempt(archive, z, x, y)
  }
}

async function attempt(archive: Archive, z: number, x: number, y: number): Promise<{ header: Header, tile: RawTile | null }> {
  const header = await archive.cache.getHeader(archive.source)
  if (z < header.minZoom || z > header.maxZoom) return { header, tile: null }

  const tileId = zxyToTileId(z, x, y)
  let offset = header.rootDirectoryOffset
  let length = header.rootDirectoryLength
  // Root plus up to three levels of leaf directories, as the spec allows.
  for (let depth = 0; depth <= 3; depth++) {
    const directory = await archive.cache.getDirectory(archive.source, offset, length, header)
    const entry = findTile(directory, tileId)
    if (!entry) return { header, tile: null }
    if (entry.runLength > 0) {
      const bytes = await archive.source.getBytes(header.tileDataOffset + entry.offset, entry.length, undefined, header.etag)
      return { header, tile: { data: bytes.data, compression: header.tileCompression } }
    }
    offset = header.leafDirectoryOffset + entry.offset
    length = entry.length
  }
  throw new Error('PMTiles directory depth exceeded')
}

/** The Content-Encoding for a stored tile, or null when it is stored plain. */
export function contentEncoding(compression: Compression): string | null {
  switch (compression) {
    case Compression.Gzip: return 'gzip'
    case Compression.Brotli: return 'br'
    case Compression.Zstd: return 'zstd'
    default: return null
  }
}
