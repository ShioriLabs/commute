/*
 * Vector tile plumbing for shirase's build scripts: read the basemap extract,
 * decode a layer, encode tiles with point, line and polygon layers, and write
 * them out as PMTiles (via MBTiles and the pinned go-pmtiles).
 */

import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readdirSync, readSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const SHIRASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DATA_DIR = path.join(SHIRASE_DIR, 'data')
const PMTILES_BIN = path.join(SHIRASE_DIR, '.tools', 'pmtiles-1.31.2', 'pmtiles')

// ── projection ─────────────────────────────────────────────────────────────

/** Fractional tile position of a lon/lat at a zoom. */
export function project(lon, lat, zoom) {
  const n = 2 ** zoom
  const s = Math.sin((lat * Math.PI) / 180)
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
}

export function unproject(fx, fy, zoom) {
  const n = 2 ** zoom
  return [(fx / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * fy) / n))) * 180) / Math.PI]
}

/** Ground metres across one tile at a zoom, at the latitude of tile row y. */
export function tileMetres(zoom, y) {
  const [, lat] = unproject(0, y + 0.5, zoom)
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

// ── reading the extract ─────────────────────────────────────────────────────

/** A pmtiles Source over a local file. */
export class FileSource {
  constructor(file) {
    this.file = file
    this.fd = openSync(file, 'r')
  }

  getKey() { return this.file }

  async getBytes(offset, length) {
    const buf = Buffer.alloc(length)
    readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) }
  }

  close() { closeSync(this.fd) }
}

/** The newest basemap extract in data/ (named for its build date). */
export function newestBasemap() {
  const names = readdirSync(DATA_DIR).filter(f => /^[a-z0-9-]+-\d{8}\.pmtiles$/.test(f)).sort()
  if (names.length === 0) throw new Error('No basemap extract in data/; run `extract -- --write` first.')
  return path.join(DATA_DIR, names.at(-1))
}

// ── decoding ───────────────────────────────────────────────────────────────

function reader(buf) {
  let i = 0
  const varint = () => {
    let r = 0
    let s = 0
    let b
    do {
      b = buf[i++]
      r += (b & 127) * 2 ** s
      s += 7
    } while (b >= 128)
    return r
  }
  return {
    get done() { return i >= buf.length },
    varint,
    next() {
      const key = varint()
      const field = Math.floor(key / 8)
      const wire = key & 7
      if (wire === 0) return [field, varint()]
      const size = wire === 1 ? 8 : wire === 5 ? 4 : wire === 2 ? varint() : -1
      if (size < 0) throw new Error(`wire type ${wire}`)
      const v = buf.subarray(i, i + size)
      i += size
      return [field, v]
    }
  }
}

const packed = (buf) => {
  const r = reader(buf)
  const out = []
  while (!r.done) out.push(r.varint())
  return out
}

function decodeValue(buf) {
  const [field, v] = reader(buf).next()
  if (field === 1) return Buffer.from(v).toString()
  if (field === 2) return Buffer.from(v).readFloatLE()
  if (field === 3) return Buffer.from(v).readDoubleLE()
  if (field === 7) return v !== 0
  return v
}

const unzig = n => (n % 2 === 1 ? -(n + 1) / 2 : n / 2)

/*
 * One layer's features: [{ type, props, rings }], where `rings` is the
 * geometry's parts in tile units (points, line parts, or polygon rings in
 * order). Also returns the layer's extent.
 */
export function decodeLayer(tile, name) {
  const t = reader(tile)
  while (!t.done) {
    const [field, layerBuf] = t.next()
    if (field !== 3) continue
    const parts = []
    const r = reader(layerBuf)
    while (!r.done) parts.push(r.next())
    if (Buffer.from(parts.find(([f]) => f === 1)[1]).toString() !== name) continue
    const keys = parts.filter(([f]) => f === 3).map(([, v]) => Buffer.from(v).toString())
    const values = parts.filter(([f]) => f === 4).map(([, v]) => decodeValue(v))
    const extent = parts.find(([f]) => f === 5)?.[1] ?? 4096
    const features = []
    for (const [f, featBuf] of parts) {
      if (f !== 2) continue
      const fr = reader(featBuf)
      let tags = []
      let type = 0
      let geom = []
      while (!fr.done) {
        const [ff, v] = fr.next()
        if (ff === 2) tags = packed(v)
        else if (ff === 3) type = v
        else if (ff === 4) geom = packed(v)
      }
      const props = {}
      for (let k = 0; k < tags.length; k += 2) props[keys[tags[k]]] = values[tags[k + 1]]
      const rings = []
      let x = 0
      let y = 0
      let ring = null
      for (let g = 0; g < geom.length;) {
        const cmd = geom[g] & 7
        const count = geom[g] >> 3
        g++
        if (cmd === 7) continue
        for (let c = 0; c < count; c++) {
          x += unzig(geom[g++])
          y += unzig(geom[g++])
          if (cmd === 1) rings.push(ring = [[x, y]])
          else ring.push([x, y])
        }
      }
      features.push({ type, props, rings })
    }
    return { extent, features }
  }
  return { extent: 4096, features: [] }
}

/** Road lines of the basemap's `roads` layer: [{ props, lines }], tile units. */
export function decodeRoads(tile) {
  return decodeLayer(tile, 'roads').features
    .filter(f => f.type === 2)
    .map(f => ({ props: f.props, lines: f.rings.filter(l => l.length >= 2) }))
}

// ── encoding ───────────────────────────────────────────────────────────────

const writeVarint = (out, value) => {
  let v = value
  while (v > 127) {
    out.push((v & 127) | 128)
    v = Math.floor(v / 128)
  }
  out.push(v)
}
const zigzag = n => (n << 1) ^ (n >> 31)
const field = (out, number, wire) => writeVarint(out, (number << 3) | wire)
const bytes = (out, number, data) => {
  field(out, number, 2)
  writeVarint(out, data.length)
  for (const b of data) out.push(b)
}

/** Twice the signed area by the surveyor's formula in tile coordinates (y down). */
export function ringArea(ring) {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    sum += x1 * y2 - x2 * y1
  }
  return sum
}

/*
 * Geometry commands for one feature.
 *   type 1: rings = [[x, y], ...] points
 *   type 2: rings = lines
 *   type 3: rings = polygons, each [outer, ...holes]. The MVT spec wants an
 *           exterior ring with positive area (by ringArea, y down) and holes
 *           negative; rings are rewound here rather than trusted.
 */
function geometry(type, parts) {
  const out = []
  let cx = 0
  let cy = 0
  const moveTo = ([x, y]) => {
    writeVarint(out, (1 & 7) | (1 << 3))
    writeVarint(out, zigzag(x - cx))
    writeVarint(out, zigzag(y - cy))
    cx = x
    cy = y
  }
  const lineTo = (points) => {
    writeVarint(out, (2 & 7) | (points.length << 3))
    for (const [x, y] of points) {
      writeVarint(out, zigzag(x - cx))
      writeVarint(out, zigzag(y - cy))
      cx = x
      cy = y
    }
  }
  if (type === 1) {
    writeVarint(out, (1 & 7) | (parts.length << 3))
    for (const [x, y] of parts) {
      writeVarint(out, zigzag(x - cx))
      writeVarint(out, zigzag(y - cy))
      cx = x
      cy = y
    }
  } else if (type === 2) {
    for (const line of parts) {
      moveTo(line[0])
      lineTo(line.slice(1))
    }
  } else {
    for (const polygon of parts) {
      polygon.forEach((ring, k) => {
        const wantPositive = k === 0
        const r = (ringArea(ring) > 0) === wantPositive ? ring : [...ring].reverse()
        moveTo(r[0])
        lineTo(r.slice(1))
        writeVarint(out, (7 & 7) | (1 << 3)) // ClosePath
      })
    }
  }
  return out
}

/*
 * One Mapbox Vector Tile. layers: [{ name, features: [{ type, parts, props }] }]
 * with integer coordinates in `extent` units.
 */
export function encodeTile(layers, extent = 4096) {
  const tile = []
  for (const { name, features } of layers) {
    if (features.length === 0) continue
    const keys = []
    const keyIndex = new Map()
    const values = []
    const valueIndex = new Map()
    const indexOf = (list, index, v, key = v) => {
      if (!index.has(key)) {
        index.set(key, list.length)
        list.push(v)
      }
      return index.get(key)
    }
    const layer = []
    writeVarint(layer, (15 << 3) | 0)
    writeVarint(layer, 2)
    bytes(layer, 1, Buffer.from(name))
    for (const f of features) {
      const feature = []
      const tags = []
      for (const [k, v] of Object.entries(f.props)) {
        writeVarint(tags, indexOf(keys, keyIndex, k))
        writeVarint(tags, indexOf(values, valueIndex, v, typeof v + ':' + v))
      }
      bytes(feature, 2, tags)
      field(feature, 3, 0)
      writeVarint(feature, f.type)
      bytes(feature, 4, geometry(f.type, f.parts))
      bytes(layer, 2, feature)
    }
    for (const k of keys) bytes(layer, 3, Buffer.from(k))
    for (const v of values) {
      const value = []
      if (typeof v === 'string') {
        bytes(value, 1, Buffer.from(v))
      } else {
        field(value, 3, 1)
        const b = Buffer.alloc(8)
        b.writeDoubleLE(v)
        for (const x of b) value.push(x)
      }
      bytes(layer, 4, value)
    }
    field(layer, 5, 0)
    writeVarint(layer, extent)
    bytes(tile, 3, layer)
  }
  return Buffer.from(tile)
}

// ── writing PMTiles ─────────────────────────────────────────────────────────

/*
 * Tiles straight to disk as they are built: an MBTiles file written as it
 * goes, converted to PMTiles with the pinned go-pmtiles at the end. Holding
 * every tile until the end took the jp-roads build to its 4 GB heap limit.
 *
 * meta: MBTiles metadata (name, minzoom, maxzoom, bounds, center,
 * attribution, json). add() takes encoded, uncompressed tiles.
 */
export class PmtilesWriter {
  constructor(file, meta) {
    this.file = file
    this.mbtiles = file.replace(/\.pmtiles$/, '.mbtiles')
    rmSync(this.mbtiles, { force: true })
    this.db = new DatabaseSync(this.mbtiles)
    this.db.exec('CREATE TABLE metadata (name text, value text); CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);')
    const insertMeta = this.db.prepare('INSERT INTO metadata VALUES (?, ?)')
    for (const [k, v] of Object.entries({ format: 'pbf', ...meta })) insertMeta.run(k, String(v))
    this.insert = this.db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)')
    this.count = 0
    this.bytes = 0
    this.db.exec('BEGIN')
  }

  add({ z, x, y, data }) {
    // MBTiles rows count from the bottom (TMS).
    this.insert.run(z, x, 2 ** z - 1 - y, gzipSync(data))
    this.count++
    this.bytes += data.length
    if (this.count % 500 === 0) {
      this.db.exec('COMMIT')
      this.db.exec('BEGIN')
    }
  }

  finish() {
    this.db.exec('COMMIT')
    this.db.close()
    rmSync(this.file, { force: true })
    execFileSync(PMTILES_BIN, ['convert', '--quiet', this.mbtiles, this.file], { stdio: 'inherit' })
    rmSync(this.mbtiles)
  }
}
