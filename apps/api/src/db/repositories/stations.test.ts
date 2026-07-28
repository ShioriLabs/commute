import { afterEach, describe, expect, it, vi } from 'vitest'

// The repository builds queries via the `db(d1)` Kysely factory and then runs a
// pure mapping loop over the rows. We mock `db` so the query builder is a chainable
// no-op whose terminal methods (execute / executeTakeFirst / ...) return queued
// fixture rows — that exercises the real mapping/branching without a live D1.
const terminalResults: unknown[] = []

function nextResult() {
  return terminalResults.length ? terminalResults.shift() : []
}

// A Proxy-based chainable builder: any property access returns a function that
// either resolves a queued terminal result (for execute*) or returns the builder
// itself (for selectFrom/where/leftJoin/... callbacks are accepted and ignored).
function makeBuilder(): unknown {
  const builder: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(builder, {
    get(_target, prop: string) {
      if (prop === 'then') return undefined // not a thenable
      if (prop === 'execute') return () => Promise.resolve(nextResult())
      if (prop === 'executeTakeFirst' || prop === 'executeTakeFirstOrThrow') {
        return () => Promise.resolve(nextResult())
      }
      if (prop === 'compile') return () => ({ sql: 'SELECT 1', parameters: [] })
      // Every other builder method (selectFrom, select, where, leftJoin, groupBy,
      // insertInto, values, onConflict, orderBy, limit, offset, set, ...) is chainable.
      return () => proxy
    }
  })
  return proxy
}

vi.mock('db', () => ({
  db: () => makeBuilder()
}))

// Imported after the mock is registered.
const { StationRepository } = await import('db/repositories/stations')

function makeD1() {
  return {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({ __stmt: true })) })),
    batch: vi.fn(() => Promise.resolve([]))
  } as unknown as D1Database
}

function repo() {
  return new StationRepository(makeD1())
}

afterEach(() => {
  terminalResults.length = 0
  vi.clearAllMocks()
})

describe('StationRepository.getAll (row mapping)', () => {
  it('maps rows: parses lines, amenities, and coerces searchable', async () => {
    terminalResults.push([
      {
        id: 'KCI-BOO',
        operator: 'KCI',
        lines: 'C,B',
        amenities: JSON.stringify([{ type: 'TOILET' }]),
        searchable: 1
      }
    ])
    const result = await repo().getAll()
    expect(result).toHaveLength(1)
    expect(result[0]?.operator).toBe('KCI')
    expect(result[0]?.searchable).toBe(true)
    expect(result[0]?.amenities).toEqual([{ type: 'TOILET' }])
    // Operator-qualified line keys, not embedded Line objects.
    expect(result[0]?.lines.slice().sort()).toEqual(['KCI:B', 'KCI:C'])
  })

  it('skips rows with an unresolvable operator', async () => {
    terminalResults.push([
      { id: 'x', operator: 'ZZZ', lines: null, amenities: null, searchable: 0 },
      { id: 'KCI-BOO', operator: 'KCI', lines: null, amenities: null, searchable: 1 }
    ])
    const result = await repo().getAll()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('KCI-BOO')
  })

  it('ignores NUL and unknown line codes; empty amenities when null', async () => {
    terminalResults.push([
      { id: 'KCI-BOO', operator: 'KCI', lines: 'NUL,ZZ,C', amenities: null, searchable: 1 }
    ])
    const [row] = await repo().getAll()
    expect(row?.lines).toEqual(['KCI:C'])
    expect(row?.amenities).toEqual([])
  })

  it('accepts pagination params', async () => {
    terminalResults.push([])
    await expect(repo().getAll(2, 10)).resolves.toEqual([])
  })
})

describe('StationRepository.getAllByOperator (row mapping)', () => {
  it('maps rows for a given operator', async () => {
    terminalResults.push([
      { id: 'KCI-BOO', operator: 'KCI', lines: 'C,NUL', amenities: JSON.stringify([{ type: 'LIFT' }]), searchable: 1 }
    ])
    const result = await repo().getAllByOperator('KCI')
    expect(result).toHaveLength(1)
    expect(result[0]?.operator).toBe('KCI')
    expect(result[0]?.lines).toEqual(['KCI:C'])
    expect(result[0].amenities).toEqual([{ type: 'LIFT' }])
  })

  it('skips rows whose operator is unresolvable', async () => {
    terminalResults.push([
      { id: 'x', operator: 'ZZZ', lines: null, amenities: null, searchable: 0 }
    ])
    await expect(repo().getAllByOperator('KCI')).resolves.toEqual([])
  })

  it('accepts pagination params', async () => {
    terminalResults.push([])
    await expect(repo().getAllByOperator('KCI', 1, 5)).resolves.toEqual([])
  })
})

describe('StationRepository read passthroughs', () => {
  it('getNameIndexRowsByOperator returns rows as-is', async () => {
    const rows = [{ code: 'BOO', name: 'Bogor', formattedName: null }]
    terminalResults.push(rows)
    await expect(repo().getNameIndexRowsByOperator('KCI')).resolves.toBe(rows)
  })

  it('getTimetableFromStationId returns rows (with line + pagination filters)', async () => {
    const rows = [{ id: 's1', lineCode: 'C' }]
    terminalResults.push(rows)
    await expect(repo().getTimetableFromStationId('KCI-BOO', 'C', 1, 10)).resolves.toBe(rows)
  })

  it('getTimetableFromStationId works without optional filters', async () => {
    terminalResults.push([])
    await expect(repo().getTimetableFromStationId('KCI-BOO')).resolves.toEqual([])
  })

  it('getGroupingTimetableFromStationId returns projected rows', async () => {
    const rows = [{ id: 's1', lineCode: 'C', boundFor: 'JAKK', estimatedDeparture: '10:00', tripNumber: 'C1' }]
    terminalResults.push(rows)
    await expect(repo().getGroupingTimetableFromStationId('KCI-BOO')).resolves.toBe(rows)
  })
})

describe('StationRepository.getById', () => {
  it('returns null when no station is found', async () => {
    terminalResults.push(undefined) // executeTakeFirst -> nothing
    await expect(repo().getById('missing')).resolves.toBe(null)
  })

  it('returns null when the operator cannot be resolved', async () => {
    terminalResults.push({ id: 'x', operator: 'ZZZ', lines: null, amenities: null, searchable: 0 })
    await expect(repo().getById('x')).resolves.toBe(null)
  })

  it('maps a found station', async () => {
    terminalResults.push({ id: 'KCI-BOO', operator: 'KCI', lines: 'C', amenities: null, searchable: 1 })
    const station = await repo().getById('KCI-BOO')
    expect(station).not.toBeNull()
    expect(station?.operator).toBe('KCI')
    expect(station?.lines[0]).toBe('KCI:C')
  })
})

describe('StationRepository.getByIds', () => {
  it('maps multiple rows', async () => {
    terminalResults.push([
      { id: 'KCI-BOO', operator: 'KCI', lines: 'C', amenities: null, searchable: 1 },
      { id: 'MRTJ-BHI', operator: 'MRTJ', lines: 'M', amenities: null, searchable: 1 }
    ])
    const result = await repo().getByIds(['KCI-BOO', 'MRTJ-BHI'])
    expect(result.map(s => s.operator)).toEqual(['KCI', 'MRTJ'])
  })
})

describe('StationRepository.checkIfExists / checkIfLineExists', () => {
  it('reports existence true with the row', async () => {
    terminalResults.push({ id: 'KCI-BOO', timetableSynced: 1 })
    await expect(repo().checkIfExists('KCI-BOO')).resolves.toEqual({
      exists: true,
      station: { id: 'KCI-BOO', timetableSynced: 1 }
    })
  })

  it('reports existence false when nothing is found', async () => {
    terminalResults.push(undefined)
    await expect(repo().checkIfExists('missing', 'KCI')).resolves.toEqual({ exists: false, station: null })
  })

  it('reports line existence', async () => {
    terminalResults.push(undefined)
    await expect(repo().checkIfLineExists('KCI-BOO', 'C', 'KCI')).resolves.toEqual({ exists: false, line: null })
  })
})

describe('StationRepository write methods', () => {
  it('insert returns the data', async () => {
    terminalResults.push({})
    const data = { id: 'KCI-BOO', name: 'Bogor', operator: 'KCI' } as never
    await expect(repo().insert(data)).resolves.toBe(data)
  })

  it('insertMany returns the data', async () => {
    terminalResults.push({})
    const data = [{ id: 'KCI-BOO' }] as never
    await expect(repo().insertMany(data)).resolves.toBe(data)
  })

  it('update returns the data', async () => {
    const data = { name: 'New' } as never
    await expect(repo().update('KCI-BOO', data)).resolves.toBe(data)
  })

  it('del resolves', async () => {
    terminalResults.push({})
    await expect(repo().del('KCI-BOO')).resolves.toBeDefined()
  })
})

describe('StationRepository.getTransfersFromStationId', () => {
  it('shapes INTERNAL and EXTERNAL transfers and skips unresolvable ones', async () => {
    // 1st execute(): the transfers rows.
    terminalResults.push([
      { id: 1, dataType: 'INTERNAL', toStationId: 'KCI-BOO', distance: 100, notes: 'a' },
      { id: 2, dataType: 'INTERNAL', toStationId: 'GONE', distance: 50, notes: null },
      { id: 3, dataType: 'EXTERNAL', toStationData: JSON.stringify({ name: 'Ext' }), distance: 200, notes: null },
      { id: 4, dataType: 'UNKNOWN', distance: 0, notes: null }
    ])
    // 2nd execute(): getByIds() lookup for INTERNAL targets (only KCI-BOO resolves).
    terminalResults.push([
      { id: 'KCI-BOO', code: 'BOO', operator: 'KCI', lines: 'C', amenities: null, searchable: 1, name: 'Bogor', formattedName: null }
    ])

    const result = await repo().getTransfersFromStationId('KCI-DP')
    // INTERNAL#1 resolves, INTERNAL#2 (GONE) skipped, EXTERNAL#3 shaped, UNKNOWN#4 skipped.
    expect(result.map(t => t.id)).toEqual([1, 3])
    const internal = result[0]
    expect(internal?.dataType).toBe('INTERNAL')
    // A StationRef: `id` like every other station reference, operator as a code,
    // lines as keys.
    expect(internal?.toStation).toEqual({
      id: 'KCI-BOO',
      name: 'Bogor',
      officialName: 'Bogor',
      code: 'BOO',
      operator: 'KCI',
      lines: ['KCI:C']
    })
    expect(result[1]?.toStation).toEqual({ name: 'Ext' })
  })
})

describe('StationRepository.insertTimetable', () => {
  it('returns undefined when the station does not exist', async () => {
    terminalResults.push(undefined) // getById -> executeTakeFirst -> nothing
    await expect(repo().insertTimetable('missing', [{ id: 's1' } as never])).resolves.toBeUndefined()
  })

  it('returns the (empty) timetable untouched on an empty feed', async () => {
    terminalResults.push({ id: 'KCI-BOO', operator: 'KCI', lines: null, amenities: null, searchable: 1 })
    await expect(repo().insertTimetable('KCI-BOO', [])).resolves.toEqual([])
  })

  it('dedupes (last wins), batches, and returns the deduped set', async () => {
    terminalResults.push({ id: 'KCI-BOO', operator: 'KCI', lines: null, amenities: null, searchable: 1 })
    const d1 = makeD1()
    const r = new StationRepository(d1)
    const feed = [
      { id: 'dup', boundFor: 'A' },
      { id: 'dup', boundFor: 'B' },
      { id: 'other', boundFor: 'C' }
    ] as never[]
    const result = await r.insertTimetable('KCI-BOO', feed)
    expect(result).toEqual([{ id: 'dup', boundFor: 'B' }, { id: 'other', boundFor: 'C' }])
    expect((d1.batch as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })
})
