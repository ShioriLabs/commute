import { OPERATORS } from '@commute/constants'
import { describe, expect, it, vi } from 'vitest'
import type { LineTopology } from 'db/data/topology'
import type { Line } from 'models/line'
import { buildLineDetail, collectStationIds, findTopology } from 'utils/topology'

const LINE_C: Line = { name: 'Lin Cikarang', colorCode: '#25B8EB', lineCode: 'C' }
const OTHER_LINE: Line = { name: 'Other', colorCode: '#000000', lineCode: 'X' }

/*
 * Minimal hydrated-station shape. `name` is already the display name — the
 * repository resolves it before topology sees a station — and `lines` are
 * operator-qualified keys.
 */
function station(code: string, opts: { name?: string, lines?: string[] } = {}) {
  return {
    id: `KCI-${code}`,
    code,
    name: opts.name ?? code,
    lines: opts.lines ?? [`KCI:${LINE_C.lineCode}`]
  }
}

function mapOf(...stations: ReturnType<typeof station>[]) {
  return new Map(stations.map(s => [s.id, s]))
}

describe('findTopology', () => {
  it('finds a real topology entry', () => {
    const topo = findTopology('KCI', 'C')
    expect(topo).not.toBeNull()
    expect(topo?.operator).toBe('KCI')
    expect(topo?.lineCode).toBe('C')
  })

  it('returns null for an unknown operator', () => {
    expect(findTopology('NUL', 'C')).toBe(null)
  })

  it('returns null for an unknown line code', () => {
    expect(findTopology('KCI', 'ZZ')).toBe(null)
  })
})

describe('collectStationIds', () => {
  it('prefixes trunk and branch stations with the operator', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'BBB', pos: 'C2' }],
      branches: [{ fromStation: 'BBB', path: [{ station: 'CCC', pos: 'C3' }] }]
    }
    expect(collectStationIds(topo)).toEqual(['KCI-AAA', 'KCI-BBB', 'KCI-CCC'])
  })

  it('returns only trunk ids when there are no branches', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }]
    }
    expect(collectStationIds(topo)).toEqual(['KCI-AAA'])
  })
})

describe('buildLineDetail', () => {
  it('builds a TRUNK segment and resolves station detail', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [
        { station: 'AAA', pos: 'C1', cumM: 0 },
        { station: 'BBB', pos: 'C2', cumM: 1500 }
      ]
    }
    const detail = buildLineDetail(topo, LINE_C, OPERATORS.KCI, mapOf(station('AAA'), station('BBB')))

    expect(detail.operator).toEqual({ code: 'KCI', name: 'Commuter Line' })
    expect(detail.segments).toHaveLength(1)
    const trunk = detail.segments[0]
    expect(trunk.kind).toBe('TRUNK')
    expect(trunk.stations.map(s => s.code)).toEqual(['AAA', 'BBB'])
    expect(trunk.stations[0].stationNumber).toBe('C1')
  })

  it('uses the display name the repository resolved', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'BBB', pos: 'C2' }]
    }
    const detail = buildLineDetail(
      topo,
      LINE_C,
      OPERATORS.KCI,
      mapOf(
        station('AAA', { name: 'Pretty A' }),
        station('BBB', { name: 'raw-b' })
      )
    )
    const [a, b] = detail.segments[0].stations
    expect(a?.name).toBe('Pretty A')
    expect(b?.name).toBe('raw-b')
  })

  it('marks a station as an interchange, excluding the current line from otherLines', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }]
    }
    const detail = buildLineDetail(
      topo,
      LINE_C,
      OPERATORS.KCI,
      mapOf(station('AAA', { lines: [`KCI:${LINE_C.lineCode}`, `KCI:${OTHER_LINE.lineCode}`] }))
    )
    const s = detail.segments[0]?.stations[0]
    expect(s?.isInterchange).toBe(true)
    // Line keys, and the current line is excluded.
    expect(s?.otherLines).toEqual(['KCI:X'])
  })

  it('classifies a closeTo branch as LOOP', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'JNC', pos: 'C2' }],
      branches: [{ fromStation: 'JNC', path: [{ station: 'LP1', pos: 'C3' }], closeTo: 'JNC' }]
    }
    const detail = buildLineDetail(topo, LINE_C, OPERATORS.KCI, mapOf(station('AAA'), station('JNC'), station('LP1')))
    const loop = detail.segments[1]
    expect(loop?.kind).toBe('LOOP')
    expect(loop?.joinsAtCode).toBe('JNC')
  })

  it('classifies the first trunk-end branch as CONTINUATION and later siblings as RAMP', () => {
    // Ordering is significant: only the first non-loop branch at the trunk end
    // reads as the mainline continuation; siblings at the same junction are ramps.
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'END', pos: 'C2' }],
      branches: [
        { fromStation: 'END', path: [{ station: 'CON', pos: 'C3' }] },
        { fromStation: 'END', path: [{ station: 'RMP', pos: 'C4' }] }
      ]
    }
    const detail = buildLineDetail(
      topo,
      LINE_C,
      OPERATORS.KCI,
      mapOf(station('AAA'), station('END'), station('CON'), station('RMP'))
    )
    expect(detail.segments[1].kind).toBe('CONTINUATION')
    expect(detail.segments[2].kind).toBe('RAMP')
  })

  it('classifies a non-trunk-end branch as RAMP', () => {
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'MID', pos: 'C2' }, { station: 'END', pos: 'C3' }],
      branches: [{ fromStation: 'MID', path: [{ station: 'RMP', pos: 'C4' }] }]
    }
    const detail = buildLineDetail(
      topo,
      LINE_C,
      OPERATORS.KCI,
      mapOf(station('AAA'), station('MID'), station('END'), station('RMP'))
    )
    expect(detail.segments[1].kind).toBe('RAMP')
  })

  it('skips stations missing from the map and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'GONE', pos: 'C2' }]
    }
    const detail = buildLineDetail(topo, LINE_C, OPERATORS.KCI, mapOf(station('AAA')))
    expect(detail.segments[0].stations.map(s => s.code)).toEqual(['AAA'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('produces empty station lists when the map is empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const topo: LineTopology = {
      operator: 'KCI',
      lineCode: 'C',
      path: [{ station: 'AAA', pos: 'C1' }, { station: 'BBB', pos: 'C2' }]
    }
    const detail = buildLineDetail(topo, LINE_C, OPERATORS.KCI, new Map())
    expect(detail.segments[0].stations).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
