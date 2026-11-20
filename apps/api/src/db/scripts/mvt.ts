/*
 * A minimal Mapbox Vector Tile reader: the layers, their features' properties,
 * and line geometry, which is all busMapRoads.ts needs from shirase's tiles.
 * https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

export interface TileFeature {
  /** 1 point, 2 line, 3 polygon. */
  type: number
  properties: Record<string, string | number | boolean>
  /** Each part's points in tile units (0..extent). */
  geometry: [number, number][][]
}

export interface TileLayer {
  name: string
  extent: number
  features: TileFeature[]
}

class Reader {
  pos = 0
  constructor(private readonly buf: Uint8Array, private readonly end = buf.length) {}

  get more(): boolean {
    return this.pos < this.end
  }

  varint(): number {
    let result = 0
    let shift = 0
    let b: number
    do {
      b = this.buf[this.pos++]!
      result += (b & 0x7f) * 2 ** shift
      shift += 7
    } while (b & 0x80)
    return result
  }

  /** A field's key: its number and wire type. */
  key(): [number, number] {
    const k = this.varint()
    return [Math.floor(k / 8), k & 7]
  }

  bytes(): Uint8Array {
    const length = this.varint()
    const out = this.buf.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }

  sub(): Reader {
    const length = this.varint()
    const r = new Reader(this.buf, this.pos + length)
    r.pos = this.pos
    this.pos += length
    return r
  }

  skip(wire: number): void {
    if (wire === 0) this.varint()
    else if (wire === 1) this.pos += 8
    else if (wire === 2) this.pos += this.varint()
    else if (wire === 5) this.pos += 4
    else throw new Error(`MVT: wire type ${wire}`)
  }

  packed(): number[] {
    const r = this.sub()
    const out: number[] = []
    while (r.more) out.push(r.varint())
    return out
  }
}

const zigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2)

function value(r: Reader): string | number | boolean {
  let out: string | number | boolean = ''
  while (r.more) {
    const [field, wire] = r.key()
    if (field === 1) out = new TextDecoder().decode(r.bytes())
    else if (field === 2) {
      out = new DataView(r['buf'].buffer, r['buf'].byteOffset + r.pos, 4).getFloat32(0, true)
      r.pos += 4
    } else if (field === 3) {
      out = new DataView(r['buf'].buffer, r['buf'].byteOffset + r.pos, 8).getFloat64(0, true)
      r.pos += 8
    } else if (field === 4 || field === 5) out = r.varint()
    else if (field === 6) out = zigzag(r.varint())
    else if (field === 7) out = r.varint() === 1
    else r.skip(wire)
  }
  return out
}

function geometry(commands: number[]): [number, number][][] {
  const parts: [number, number][][] = []
  let x = 0
  let y = 0
  let i = 0
  let part: [number, number][] = []
  while (i < commands.length) {
    const header = commands[i++]!
    const id = header & 7
    const count = header >> 3
    if (id === 7) {
      if (part.length > 0) part.push(part[0]!)
      continue
    }
    for (let k = 0; k < count; k++) {
      x += zigzag(commands[i++]!)
      y += zigzag(commands[i++]!)
      if (id === 1) {
        if (part.length > 0) parts.push(part)
        part = []
      }
      part.push([x, y])
    }
  }
  if (part.length > 0) parts.push(part)
  return parts
}

/** The layers of a decoded (not gzipped) tile, only those [wanted] if given. */
export function readTile(data: Uint8Array, wanted?: ReadonlySet<string>): TileLayer[] {
  const tile = new Reader(data)
  const layers: TileLayer[] = []
  while (tile.more) {
    const [field, wire] = tile.key()
    if (field !== 3) {
      tile.skip(wire)
      continue
    }
    const r = tile.sub()
    let name = ''
    let extent = 4096
    const keys: string[] = []
    const values: (string | number | boolean)[] = []
    const raw: { type: number, tags: number[], commands: number[] }[] = []
    while (r.more) {
      const [f, w] = r.key()
      if (f === 1) name = new TextDecoder().decode(r.bytes())
      else if (f === 2) {
        const fr = r.sub()
        const feature = { type: 0, tags: [] as number[], commands: [] as number[] }
        while (fr.more) {
          const [ff, fw] = fr.key()
          if (ff === 2) feature.tags = fr.packed()
          else if (ff === 3) feature.type = fr.varint()
          else if (ff === 4) feature.commands = fr.packed()
          else fr.skip(fw)
        }
        raw.push(feature)
      } else if (f === 3) keys.push(new TextDecoder().decode(r.bytes()))
      else if (f === 4) values.push(value(r.sub()))
      else if (f === 5) extent = r.varint()
      else r.skip(w)
    }
    if (wanted && !wanted.has(name)) continue
    layers.push({
      name,
      extent,
      features: raw.map((f) => {
        const properties: TileFeature['properties'] = {}
        for (let i = 0; i + 1 < f.tags.length; i += 2) properties[keys[f.tags[i]!]!] = values[f.tags[i + 1]!]!
        return { type: f.type, properties, geometry: geometry(f.commands) }
      })
    })
  }
  return layers
}
