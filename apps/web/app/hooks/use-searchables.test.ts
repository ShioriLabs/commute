import { describe, expect, it } from 'vitest'
import { migrateLegacy } from './use-searchables'

/*
 * A service-worker or SWR cache outlives a deploy, so entries written before
 * the discriminated union still arrive at current code. That is the exact
 * setup behind two crashes already, so the old shape is migrated on read.
 *
 * The old shape: one `body` array of line keys, meaning "the lines here" on a
 * station or hub and "the line this IS" (array-wrapped) on a line.
 */

const legacyStation = {
  type: 'STATION' as const,
  title: 'Bekasi',
  to: '/stations/KCI/BKS',
  keywords: ['bekasi'],
  operator: 'KCI' as const,
  body: ['KCI:C', 'KCI:B']
}

const legacyLine = {
  type: 'LINE' as const,
  title: 'Lin Bekasi',
  to: '/lines/LRTJBDB/BK',
  keywords: ['lin bekasi'],
  operator: 'LRTJBDB' as const,
  body: ['LRTJBDB:BK']
}

describe('migrateLegacy', () => {
  it('turns a station\'s body into lineKeys', () => {
    const migrated = migrateLegacy(legacyStation)
    expect(migrated).toMatchObject({ type: 'STATION', lineKeys: ['KCI:C', 'KCI:B'] })
    expect(migrated && 'body' in migrated).toBe(false)
  })

  it('unwraps a line\'s single-element body into lineKey', () => {
    const migrated = migrateLegacy(legacyLine)
    expect(migrated).toMatchObject({ type: 'LINE', lineKey: 'LRTJBDB:BK' })
    expect(migrated && 'body' in migrated).toBe(false)
  })

  it('migrates a hub the same way as a station', () => {
    const migrated = migrateLegacy({
      type: 'HUB' as const,
      title: 'Dukuh Atas',
      to: '/hubs/dukuh-atas',
      keywords: ['dukuh atas'],
      body: ['KCI:C', 'MRTJ:M']
    })
    expect(migrated).toMatchObject({ type: 'HUB', lineKeys: ['KCI:C', 'MRTJ:M'] })
  })

  /*
   * `line` is not optional on the resolved variant, so an entry that cannot
   * supply one is dropped rather than rendered half-built — that "half-built"
   * state is what crashed the sheet in the first place.
   */
  it('drops a LINE whose body is empty', () => {
    expect(migrateLegacy({ ...legacyLine, body: [] })).toBeNull()
  })

  it('leaves an already-migrated entry untouched', () => {
    const current = {
      type: 'STATION' as const,
      title: 'Bekasi',
      to: '/stations/KCI/BKS',
      keywords: ['bekasi'],
      operator: 'KCI' as const,
      lineKeys: ['KCI:C']
    }
    expect(migrateLegacy(current)).toBe(current)
  })

  it('keeps a station with no lines rather than dropping it', () => {
    // Routing-only stops legitimately serve no lines.
    expect(migrateLegacy({ ...legacyStation, body: [] })).toMatchObject({ lineKeys: [] })
  })
})
