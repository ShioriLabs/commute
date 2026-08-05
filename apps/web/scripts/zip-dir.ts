/*
 * Minimal ZIP writer.
 *
 * Exists so scripts/build-lite.ts does not depend on a `zip` binary being
 * installed (it frequently is not, including in CI images and WSL) and does not
 * pull an archiver package in for one call. Node's zlib already provides the
 * only hard part; the rest is the container format.
 *
 * Deliberately limited to what packaging a static site needs: regular files,
 * deflate, no encryption, no zip64. The lite bundle is ~40 MB across ~450
 * files, comfortably inside the classic format's limits - but the entry count
 * and offsets are checked below rather than assumed, because silently emitting
 * a corrupt archive is exactly the failure this script exists to avoid.
 */

import { deflateRawSync, crc32 } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Classic zip caps these at 32 bits / 16 bits. Past them the format needs
// zip64, which this writer does not implement.
const MAX_ZIP_BYTES = 0xFFFFFFFF
const MAX_ZIP_ENTRIES = 0xFFFF

interface Entry {
  /** Path as stored in the archive, always forward-slashed. */
  name: string
  data: Buffer
}

function collect(dir: string, base = dir): Entry[] {
  const entries: Entry[] = []
  // Sorted so the archive is reproducible: same input tree, same byte order.
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) {
      entries.push(...collect(full, base))
    } else if (item.isFile()) {
      entries.push({
        // Zip paths are '/'-separated by spec, regardless of host platform.
        name: path.relative(base, full).split(path.sep).join('/'),
        data: readFileSync(full)
      })
    }
  }
  return entries
}

/** DOS timestamp. Fixed, so repeated packaging of one tree is byte-identical. */
const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01, the format's zero point.

export function zipDirectory(sourceDir: string, outputPath: string): void {
  const entries = collect(sourceDir)

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`${entries.length} files exceeds the ${MAX_ZIP_ENTRIES}-entry limit of the classic zip format`)
  }

  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 filenames
    local.writeUInt16LE(8, 8) // method: deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra field length

    chunks.push(local, nameBytes, compressed)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014B50, 0) // central directory signature
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(DOS_TIME, 12)
    dir.writeUInt16LE(DOS_DATE, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(compressed.length, 20)
    dir.writeUInt32LE(entry.data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt16LE(0, 30) // extra
    dir.writeUInt16LE(0, 32) // comment
    dir.writeUInt16LE(0, 34) // disk number
    dir.writeUInt16LE(0, 36) // internal attrs
    // External attrs: unix mode 0644 in the high 16 bits, so extraction
    // preserves a sane mode rather than whatever the extracting umask invents.
    // Multiplied rather than shifted: `<<` works on signed 32-bit values, so
    // 0o100644 << 16 wraps negative and writeUInt32LE rejects it.
    dir.writeUInt32LE(0o100644 * 0x10000, 38)
    dir.writeUInt32LE(offset, 42)

    central.push(dir, nameBytes)
    offset += local.length + nameBytes.length + compressed.length

    if (offset > MAX_ZIP_BYTES) {
      throw new Error('archive exceeds 4 GB; this writer does not implement zip64')
    }
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // disk number
  end.writeUInt16LE(0, 6) // disk with central directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length

  writeFileSync(outputPath, Buffer.concat([...chunks, centralBuffer, end]))
}

/** Total uncompressed size of `dir`, for the packaging summary. */
export function directorySize(dir: string): number {
  let total = 0
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name)
    total += item.isDirectory() ? directorySize(full) : statSync(full).size
  }
  return total
}
