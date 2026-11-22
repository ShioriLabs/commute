import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodePolyline, type LngLat } from '../../utils/polyline'

/*
 * Peta Bus as shipped (apps/web/app/data/bus-map.json, the generator's output), held to what was got
 * wrong once at the trunk koridors' termini and around them. Each was a fix to the generator that a
 * later one could quietly undo; regenerate and these say where.
 *
 * The gotchas, as found (2026-11-22):
 * - The feed's trips start and end where buses wait, not at the halte the topology ends at: 9 and 12
 *   at Pluit 1, 97 m on past Pluit; 6 past Ragunan, round a loop between where its trips in end and
 *   its trips out start. A terminus's way is in the trips, not in any one leg between haltes.
 * - A road passing a terminus isn't the way out of it: the Kuningan flyover passes Flyover Kuningan's
 *   halte 33 m off, and 13E was drawn leaving along it, where its trips go round by Cokroaminoto.
 * - Joining a run's end to where the next starts must be straight on: 1 in along the street to Blok
 *   M and out of its bay 12 m off it got a tick across. So must a run's start be where its trip
 *   passes the halte, not where it waits: 12 started back at Pluit and stepped back to it.
 * - The road tiles have no lanes inside terminals: Ragunan's halte is 23 m off the road round it, and
 *   snapping the way through onto that road missed the halte. But a street halte off the tiles' road
 *   (Pecenongan's) is beside a street they leave out, and the line stays on the road there.
 * - Roads meet partway along each other: Purworejo ends on the middle of its slip road onto
 *   Latuharhari, the slip road on the middle of Latuharhari. Taken as unjoined, 6 turned at the corner.
 * - A halte's own coordinate lies between the lanes it has: Galunggung's platforms say 6 calls on the
 *   south lane, 4 on the north.
 * - A topology without a pathReverse runs back the same haltes: 3 was drawn Kalideres -> Monas only.
 * - 3's turn at Monumen Nasional is round the Arjuna Wijaya fountain's busway ring, which only its
 *   round trips run in the feed: a waypoint (generateBusMap.ts VIA), per the user. 2 passes Monas
 *   on round onto Medan Merdeka Selatan for Gambir; it doesn't turn there.
 * - An elevated busway is a bridge, kept off by the road matcher (a flyover over a koridor's own lane),
 *   but it is the 13 family's own way: westbound they came down to the street under it past Velbak.
 *   Only a koridor's own, by the busway's name: 13's past Blok M runs over 1's lane at Palatehan.
 */

const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../web/app/data/bus-map.json'), 'utf-8')) as {
  lines: { code: string, drawn: string[] }[]
  haltes: Record<string, [string, number, number]>
}
const FEED = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../web/app/data/bus-map-feed.json'), 'utf-8')) as {
  lines: { code: string, shapes: string[], platforms?: LngLat[] }[]
}

/** The koridors Peta Bus draws (busMapBundle.ts isDrawn's trunks). */
const TRUNKS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '13E', 'L13E']

type XY = [number, number]
const KX = 110_670
const KY = 110_574
const xy = ([lng, lat]: LngLat): XY => [lng * KX, lat * KY]

/** A line's street-zoom pieces (precision 6), in metres. */
const drawn = (code: string): XY[][] => MAP.lines.find(l => l.code === code)!.drawn.map(s => decodePolyline(s, 6).map(xy))
const halte = (name: string): XY => {
  const found = Object.values(MAP.haltes).find(h => h[0] === name)
  if (!found) throw new Error(`no halte ${name}`)
  return xy([found[1], found[2]])
}
const offset = ([x, y]: XY, east: number, north: number): XY => [x + east, y + north]

function distanceTo(pieces: readonly XY[][], [x, y]: XY): number {
  let best = Infinity
  for (const piece of pieces) {
    for (let i = 1; i < piece.length; i++) {
      const [ax, ay] = piece[i - 1]!
      const [bx, by] = piece[i]!
      const dx = bx - ax
      const dy = by - ay
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
    }
  }
  return best
}

/** The point [m] metres along [piece]. */
function along(piece: readonly XY[], m: number): XY {
  let walked = 0
  for (let i = 1; i < piece.length; i++) {
    const [ax, ay] = piece[i - 1]!
    const [bx, by] = piece[i]!
    const d = Math.hypot(bx - ax, by - ay)
    if (d > 0 && walked + d >= m) return [ax + ((bx - ax) * (m - walked)) / d, ay + ((by - ay) * (m - walked)) / d]
    walked += d
  }
  return piece[piece.length - 1]!
}

/** How far [piece]'s first 12 m turns from its way 15-45 m in, in degrees: a tick at its start. */
function hook(piece: readonly XY[]): number {
  const [a, b, c, d] = [along(piece, 0), along(piece, 12), along(piece, 15), along(piece, 45)]
  const u = [b[0] - a[0], b[1] - a[1]]
  const v = [d[0] - c[0], d[1] - c[1]]
  const lu = Math.hypot(u[0]!, u[1]!)
  const lv = Math.hypot(v[0]!, v[1]!)
  if (lu === 0 || lv === 0) return 0
  return (Math.acos(Math.max(-1, Math.min(1, (u[0]! * v[0]! + u[1]! * v[1]!) / (lu * lv)))) * 180) / Math.PI
}

const dist = (a: XY, b: XY): number => Math.hypot(b[0] - a[0], b[1] - a[1])

describe('Peta Bus as shipped, at the termini', () => {
  it('closes every trunk terminus, where one piece ends another starts, but those still open', () => {
    const open = TRUNKS.filter((code) => {
      const pieces = drawn(code)
      return pieces.some(p => Math.min(...pieces.map(q => dist(p[p.length - 1]!, q[0]!))) > 50)
    })
    // 13: its way back runs past CBD Ciledug on to Puri Beta 1.
    // 4: in along the busway to Pulo Gadung's halte, out of a bay 61 m off; no trip joins the two.
    expect(open).toEqual(['4', '13'])
  })

  it('starts and ends every trunk piece without a hook', () => {
    const hooked = TRUNKS.flatMap(code => drawn(code).flatMap((p, i) =>
      [['start', p], ['end', [...p].reverse()]].flatMap(([end, way]) => (hook(way as XY[]) > 110 ? [`${code} piece ${i} ${end as string}`] : []))))
    expect(hooked).toEqual([])
  })

  it('passes Ragunan\'s halte with 6, through the terminal the tiles draw no lanes of', () => {
    expect(distanceTo(drawn('6'), halte('Ragunan'))).toBeLessThan(5)
  })

  it('leaves Pluit with 9 and 12 from Pluit 1, on east, as their trips do', () => {
    const pluit = halte('Pluit')
    for (const code of ['9', '12']) {
      const out = drawn(code).find(p => dist(p[0]!, pluit) < 150)!
      expect(out[0]![0] - pluit[0]).toBeGreaterThan(80)
      expect(along(out, 50)[0]).toBeGreaterThan(out[0]![0] + 40)
    }
  })

  it('drives 14 on from Senen TOYOTA Rangga round by Senen Raya, to turn', () => {
    const out = drawn('14').find(p => dist(p[0]!, halte('Senen TOYOTA Rangga')) < 150)!
    const first = [out[0]!]
    for (let m = 5; m <= 600; m += 5) first.push(along(out, m))
    expect(distanceTo([first], halte('Senen Raya'))).toBeLessThan(10)
  })

  it('takes 13E and L13E out of Flyover Kuningan round by Cokroaminoto, not along the flyover by it', () => {
    const kuningan = halte('Flyover Kuningan')
    for (const code of ['13E', 'L13E']) {
      const out = drawn(code).find(p => dist(p[0]!, kuningan) < 150)!
      let north = 0
      for (const [, y] of out) {
        if (y - kuningan[1] < -300) break
        north = Math.max(north, y - kuningan[1])
      }
      expect(north).toBeGreaterThan(150)
    }
  })
})

describe('Peta Bus as shipped, on the streets round them', () => {
  it('takes 6 down Flyover Kuningan\'s slip road onto Latuharhari, not round the Kendal corner', () => {
    const kuningan = halte('Flyover Kuningan')
    expect(distanceTo(drawn('6'), offset(kuningan, -2, -40))).toBeLessThan(3)
    expect(distanceTo(drawn('6'), offset(kuningan, -17, -48))).toBeGreaterThan(10)
  })

  it('draws 6 past its platforms on Galunggung\'s south lane and 4 past theirs on the north', () => {
    const galunggung = halte('Galunggung')
    const platformsOf = (code: string): XY[] =>
      (FEED.lines.find(l => l.code === code)!.platforms ?? []).map(xy).filter(p => dist(p, galunggung) < 40)
    for (const [own, other] of [['6', '4'], ['4', '6']] as const) {
      const platforms = platformsOf(own)
      expect(platforms.length).toBeGreaterThan(0)
      for (const p of platforms) {
        expect(distanceTo(drawn(own), p)).toBeLessThan(3)
        expect(distanceTo(drawn(other), p)).toBeGreaterThan(8)
      }
    }
  })

  it('keeps 2 and 8 on the road by Pecenongan, a street halte off it, not where the feed has them', () => {
    const pecenongan = halte('Pecenongan')
    for (const code of ['2', '8']) {
      const feed = FEED.lines.find(l => l.code === code)!.shapes.map(s => decodePolyline(s).map(xy))
      expect(distanceTo(drawn(code), pecenongan)).toBeLessThan(distanceTo(feed, pecenongan) - 4)
    }
  })

  it('keeps the 13 family up on their elevated busway westbound past Velbak', () => {
    for (const code of ['13', '13E', 'L13E']) {
      for (const piece of drawn(code)) expect(distanceTo([piece], halte('Velbak'))).toBeLessThan(8)
      expect(Math.min(...drawn(code).map(p => distanceTo([p], halte('Velbak'))))).toBeLessThan(3)
    }
  })

  it('keeps 1 on its own lane at Palatehan and the 13 family on theirs above it', () => {
    const lane = offset(halte('Jln. Palatehan'), 0, 12.5)
    expect(distanceTo(drawn('1'), lane)).toBeLessThan(3)
    for (const code of ['13', '13E', 'L13E']) expect(distanceTo(drawn(code), lane)).toBeGreaterThan(5)
  })

  it('draws 3 both ways, its topology having no pathReverse', () => {
    expect(drawn('3')).toHaveLength(2)
    const kalideres = halte('Kalideres')
    expect(drawn('3').filter(p => dist(p[0]!, kalideres) < 150 || dist(p[p.length - 1]!, kalideres) < 150)).toHaveLength(2)
  })

  it('turns 3 at Monumen Nasional round the Arjuna Wijaya fountain; 2 passes on to Gambir', () => {
    const south: XY = xy([106.82289, -6.18088])
    const west: XY = xy([106.82263, -6.18063])
    expect(distanceTo(drawn('3'), south)).toBeLessThan(6)
    expect(distanceTo(drawn('3'), west)).toBeLessThan(6)
    expect(distanceTo(drawn('2'), south)).toBeGreaterThan(20)
    expect(distanceTo(drawn('2'), west)).toBeGreaterThan(20)
  })
})
