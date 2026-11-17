import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { clipLine, openOsmRoads } from './osm-roads.mjs'
import { project, unproject } from './tiles.mjs'

describe('clipLine', () => {
  it('cuts a line at the box, remembering each point\'s source segment', () => {
    const parts = clipLine([[-10, 5], [5, 5], [20, 5]], 0, 10)
    expect(parts).toHaveLength(1)
    expect(parts[0].points).toEqual([[0, 5], [5, 5], [10, 5]])
    expect(parts[0].segs).toEqual([0, 1])
  })

  it('splits a line that leaves and re-enters', () => {
    expect(clipLine([[1, 1], [1, 20], [5, 20], [5, 1]], 0, 10)).toHaveLength(2)
  })
})

describe('openOsmRoads', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'osm-roads-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // One primary road straight across the edge between tiles (x, y) and (x + 1, y),
  // two ways joined: 2 lanes, then 3.
  const [fx, fy] = project(106.83, -6.22, 15)
  const [x, y] = [Math.floor(fx), Math.floor(fy)]
  const at = tx => unproject(tx, y + 0.5, 15)
  const coords = [at(x + 0.6), at(x + 0.9), at(x + 1.2), at(x + 1.4)]
  const file = path.join(dir, 'roads.sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE roads (id INTEGER PRIMARY KEY, props TEXT, coords BLOB, spans TEXT); CREATE TABLE tiles (x INTEGER, y INTEGER, road INTEGER)')
  db.prepare('INSERT INTO roads VALUES (?, ?, ?, ?)').run(1, JSON.stringify({ kind_detail: 'primary', oneway: 'yes' }), Buffer.from(new Float64Array(coords.flat()).buffer), JSON.stringify([[0, 2, 2, null], [2, 3, 3, null]]))
  db.prepare('INSERT INTO tiles VALUES (?, ?, ?)').run(x, y, 1)
  db.prepare('INSERT INTO tiles VALUES (?, ?, ?)').run(x + 1, y, 1)
  db.close()

  it('gives neighbouring tiles the very same line where they overlap', () => {
    const roads = openOsmRoads(file)
    const left = roads.tile(x, y, 4096, 64).features[0].lines[0]
    const right = roads.tile(x + 1, y, 4096, 64).features[0].lines[0]
    roads.close()
    // Left tile's last point (64 past its edge) is right tile's x = 64 - 4096... in world terms the same:
    const world = (tx, [px, py]) => [tx + px / 4096, y + py / 4096]
    const [lx, ly] = world(x, left.at(-1))
    const [rx, ry] = world(x + 1, right[0])
    expect(Math.abs(ly - ry) * 4096).toBeLessThan(1e-6)
    // Both clips stop exactly 64 units past their own tile edge.
    expect((lx - (x + 1)) * 4096).toBeCloseTo(64, 6)
    expect((rx - (x + 1)) * 4096).toBeCloseTo(-64, 6)
  })

  it('carries each way\'s lanes along the clipped line', () => {
    const roads = openOsmRoads(file)
    const tile = roads.tile(x + 1, y, 4096, 64)
    const runs = tile.lanesFor(tile.features[0].lines[0])
    roads.close()
    expect(runs.map(r => r.lanes)).toEqual([2, 3])
    // The change sits at the joint, 0.2 of a tile into the right tile.
    expect(runs[0].to - 64).toBeCloseTo(0.2 * 4096, 0)
  })
})
