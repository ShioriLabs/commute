import { describe, expect, it } from 'vitest'
import { Operator } from '@commute/constants'
import { Line } from 'models/line'
import {
  buildSearchableIndex,
  directionalBaseName,
  IndexableHub,
  IndexableStation
} from 'utils/searchables'

const line = (lineCode: string, name = `Lin ${lineCode}`): Line => ({
  name,
  lineCode,
  colorCode: '#000000'
})

function station(overrides: Partial<IndexableStation> & { id: string, name: string, code: string }): IndexableStation {
  return {
    formattedName: null,
    regionCode: 'CGK',
    searchable: true,
    score: 0,
    operator: { code: 'TJ' as Operator, name: 'TransJakarta' },
    lines: [],
    ...overrides
  }
}

const stationItems = (index: ReturnType<typeof buildSearchableIndex>) =>
  index.items.filter(item => item.type === 'STATION')

describe('directionalBaseName', () => {
  it('strips the "Arah …" suffix', () => {
    expect(directionalBaseName('Kali Grogol Arah Utara')).toBe('Kali Grogol')
    expect(directionalBaseName('Walikota Jakarta Barat Arah Timur')).toBe('Walikota Jakarta Barat')
  })

  it('leaves other names untouched', () => {
    expect(directionalBaseName('Ancol')).toBe('Ancol')
    // "Arah" mid-name is not a direction suffix.
    expect(directionalBaseName('Arah Jaya')).toBe('Arah Jaya')
  })
})

describe('buildSearchableIndex — directional folding', () => {
  // The real case: 7R stops at Kali Grogol northbound only, so the folded entry
  // must carry the union or that route becomes unfindable.
  const pair = [
    station({
      id: 'TJ-B01',
      name: 'Kali Grogol Arah Selatan',
      code: 'B01',
      lines: [line('9'), line('7T')]
    }),
    station({
      id: 'TJ-A01',
      name: 'Kali Grogol Arah Utara',
      code: 'A01',
      lines: [line('9'), line('7R')]
    })
  ]

  it('folds a directional pair into one item', () => {
    const items = stationItems(buildSearchableIndex(pair, []))
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('Kali Grogol')
  })

  it('picks the lowest code as primary, for a stable URL', () => {
    const [item] = stationItems(buildSearchableIndex(pair, []))
    expect(item?.to).toBe('/stations/TJ/A01')
    expect(item?.data?.['station-id']).toBe('TJ-A01')
  })

  it('carries the UNION of both directions\' lines, deduped', () => {
    const [item] = stationItems(buildSearchableIndex(pair, []))
    expect(item?.body?.slice().sort()).toEqual(['TJ:7R', 'TJ:7T', 'TJ:9'])
  })

  it('keeps both directions\' names and codes searchable', () => {
    const [item] = stationItems(buildSearchableIndex(pair, []))
    expect(item?.keywords).toContain('kali grogol arah utara')
    expect(item?.keywords).toContain('kali grogol arah selatan')
    expect(item?.keywords).toContain('a01')
    expect(item?.keywords).toContain('b01') // the folded-away code still matches
    expect(item?.keywords).toContain('kali grogol')
  })

  it('takes the highest score across members', () => {
    const scored = [
      station({ id: 'TJ-A01', name: 'X Arah Utara', code: 'A01', score: 3 }),
      station({ id: 'TJ-B01', name: 'X Arah Selatan', code: 'B01', score: 9 })
    ]
    expect(stationItems(buildSearchableIndex(scored, []))[0]?.score).toBe(9)
  })

  it('never merges same-named stops across operators', () => {
    const crossOperator = [
      station({ id: 'TJ-A01', name: 'Dukuh Atas Arah Utara', code: 'A01' }),
      station({
        id: 'KCI-DKA',
        name: 'Dukuh Atas Arah Utara',
        code: 'DKA',
        operator: { code: 'KCI', name: 'Commuter Line' }
      })
    ]
    expect(stationItems(buildSearchableIndex(crossOperator, []))).toHaveLength(2)
  })

  it('leaves non-directional stations untouched', () => {
    const plain = [
      station({
        id: 'KCI-AC',
        name: 'ANCOL',
        formattedName: 'Ancol',
        code: 'AC',
        operator: { code: 'KCI', name: 'Commuter Line' },
        lines: [line('TP', 'Lin Tanjung Priok')]
      })
    ]
    const [item] = stationItems(buildSearchableIndex(plain, []))
    // formattedName wins over the SHOUTING name column.
    expect(item?.title).toBe('Ancol')
    expect(item?.subtitle).toBe('Commuter Line')
    expect(item?.to).toBe('/stations/KCI/AC')
    expect(item?.operator).toBe('KCI')
    expect(item?.keywords).toEqual(expect.arrayContaining(['ancol', 'ac']))
  })
})

describe('buildSearchableIndex — filtering', () => {
  it('excludes topology-only stops (searchable = false)', () => {
    const stations = [
      station({ id: 'TJ-1', name: 'Listed', code: '1' }),
      station({ id: 'TJ-2', name: 'Feeder', code: '2', searchable: false })
    ]
    const items = stationItems(buildSearchableIndex(stations, []))
    expect(items.map(item => item.title)).toEqual(['Listed'])
  })

  it('excludes stations outside Jabodetabek', () => {
    const stations = [
      station({ id: 'KCI-1', name: 'Jakarta', code: '1' }),
      station({ id: 'KCI-2', name: 'Jogja', code: '2', regionCode: 'YIA' })
    ]
    const items = stationItems(buildSearchableIndex(stations, []))
    expect(items.map(item => item.title)).toEqual(['Jakarta'])
  })

  it('omits score entirely when 0, so the field costs nothing on the wire', () => {
    const [item] = stationItems(buildSearchableIndex([station({ id: 'TJ-1', name: 'X', code: '1' })], []))
    expect(item).not.toHaveProperty('score')
  })
})

describe('buildSearchableIndex — hubs', () => {
  const hub: IndexableHub = {
    slug: 'dukuh-atas',
    name: 'Dukuh Atas',
    kind: 'hub',
    score: 100,
    members: [
      {
        name: 'SUDIRMAN',
        code: 'SUD',
        formattedName: 'Sudirman',
        operator: { code: 'KCI' },
        lines: [line('C', 'Lin Cikarang')]
      },
      {
        name: 'DUKUH ATAS BNI',
        code: 'DKA',
        formattedName: 'Dukuh Atas BNI',
        operator: { code: 'MRTJ' },
        lines: [line('M', 'Lin Utara Selatan')]
      }
    ]
  }

  it('makes every member findable by name, code, and formatted name', () => {
    const [item] = buildSearchableIndex([], [hub]).items
    expect(item?.type).toBe('HUB')
    expect(item?.keywords).toEqual(expect.arrayContaining([
      'dukuh atas', 'sudirman', 'sud', 'dukuh atas bni', 'dka'
    ]))
  })

  it('labels the kind and links to the hub page', () => {
    const [item] = buildSearchableIndex([], [hub]).items
    expect(item?.subtitle).toBe('Pumpunan Moda')
    expect(item?.to).toBe('/hubs/dukuh-atas')
    expect(item?.data?.['hub-id']).toBe('dukuh-atas')
    expect(item?.score).toBe(100)
  })

  it('uses the plainer label for an integrated grouping', () => {
    const [item] = buildSearchableIndex([], [{ ...hub, kind: 'integrated' }]).items
    expect(item?.subtitle).toBe('Stasiun Terintegrasi')
  })

  // The reason line keys are operator-qualified: a hub spans operators, so bare
  // codes would be ambiguous the moment two operators share one.
  it('qualifies each line by the operator of the member that serves it', () => {
    const index = buildSearchableIndex([], [hub])
    const [item] = index.items
    expect(item?.body).toEqual(['KCI:C', 'MRTJ:M'])
    for (const key of item?.body ?? []) {
      expect(index.lines[key]).toBeDefined()
    }
  })

  it('dedupes a line served by more than one member', () => {
    const shared: IndexableHub = {
      ...hub,
      members: [
        { name: 'A', code: 'A', formattedName: null, operator: { code: 'KCI' }, lines: [line('C')] },
        { name: 'B', code: 'B', formattedName: null, operator: { code: 'KCI' }, lines: [line('C')] }
      ]
    }
    expect(buildSearchableIndex([], [shared]).items[0]?.body).toEqual(['KCI:C'])
  })
})

describe('buildSearchableIndex — lines', () => {
  const index = buildSearchableIndex([], [])
  const lines = index.items.filter(item => item.type === 'LINE')

  it('excludes TJ, whose line pages need topology that does not exist yet', () => {
    expect(lines.some(item => item.operator === 'TJ')).toBe(false)
    expect(lines.some(item => item.to.startsWith('/lines/TJ/'))).toBe(false)
  })

  it('excludes the NUL placeholder operator', () => {
    expect(lines.some(item => item.operator === 'NUL')).toBe(false)
  })

  it('makes a line findable without its "Lin " prefix', () => {
    const cikarang = lines.find(item => item.title.toLowerCase().includes('cikarang'))
    expect(cikarang).toBeDefined()
    expect(cikarang?.keywords.some(keyword => !keyword.startsWith('lin '))).toBe(true)
  })

  it('carries no score, so lines rank below equally-matching stations', () => {
    for (const item of lines) expect(item).not.toHaveProperty('score')
  })
})

describe('buildSearchableIndex — line dictionary', () => {
  it('resolves every body code referenced by any item', () => {
    const stations = [
      station({
        id: 'KCI-AC',
        name: 'Ancol',
        code: 'AC',
        operator: { code: 'KCI', name: 'Commuter Line' },
        lines: [line('TP', 'Lin Tanjung Priok')]
      })
    ]
    const index = buildSearchableIndex(stations, [])

    // A dangling key renders a roundel with no colour, so this is the
    // invariant that keeps the dictionary honest.
    expect(index.items.length).toBeGreaterThan(0)
    for (const item of index.items) {
      for (const key of item.body ?? []) {
        expect(index.lines[key]).toBeDefined()
      }
    }
  })

  it('keys by operator, since line codes are only unique per operator', () => {
    const index = buildSearchableIndex([], [])
    for (const key of Object.keys(index.lines)) {
      expect(key).toMatch(/^[A-Z]+:/)
    }
  })

  it('carries the name and colour needed to render a roundel', () => {
    const index = buildSearchableIndex([], [])
    const entry = index.lines['KCI:C']
    expect(entry?.name).toBeTruthy()
    expect(entry?.colorCode).toMatch(/^#/)
    expect(entry?.operator).toBe('KCI')
  })
})
