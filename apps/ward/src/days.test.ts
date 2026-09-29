import { describe, expect, it } from 'vitest'
import { archiveKey, daysBetween, hourFileName, pendingDays, uploadedMarkerName, wibDay, wibHour } from './days.ts'

// 2026-09-29 16:59:59 UTC = 23:59:59 WIB; one second later is the next WIB day.
const LAST_SECOND = Date.UTC(2026, 8, 29, 16, 59, 59)

describe('WIB calendar', () => {
  it('turns the day over at Jakarta midnight, not UTC midnight', () => {
    expect(wibDay(LAST_SECOND)).toBe('20260929')
    expect(wibDay(LAST_SECOND + 1000)).toBe('20260930')
    expect(wibHour(LAST_SECOND)).toBe(23)
    expect(wibHour(LAST_SECOND + 1000)).toBe(0)
  })

  it('names hourly files the way the spike did', () => {
    expect(hourFileName(Date.UTC(2026, 8, 29, 4, 47))).toBe('snap-20260929-11.ndjson.gz')
  })

  it('shards R2 keys by year and month', () => {
    expect(archiveKey('20260929')).toBe('raw/2026/09/snap-20260929.ndjson.zst')
  })

  it('counts whole days across a month end', () => {
    expect(daysBetween('20260929', '20261002')).toBe(3)
  })
})

describe('pendingDays', () => {
  const now = Date.UTC(2026, 9, 2, 3) // 2026-10-02 10:00 WIB
  const hours = (day: string, ...hs: string[]) => hs.map(h => `snap-${day}-${h}.ndjson.gz`)

  it('never touches today, the day the collector is still writing', () => {
    expect(pendingDays(hours('20261002', '09', '10'), [], now)).toEqual([])
  })

  it('catches up every missed day, oldest first', () => {
    const names = [...hours('20261001', '00'), ...hours('20260929', '11'), ...hours('20260930', '05')]
    expect(pendingDays(names, [], now)).toEqual(['20260929', '20260930', '20261001'])
  })

  it('treats an archive without an uploaded marker as unfinished (dry run, failed upload)', () => {
    expect(pendingDays([], ['snap-20260929.ndjson.zst'], now)).toEqual(['20260929'])
  })

  it('is done once the marker exists and the hourly files are gone', () => {
    const archive = ['snap-20260929.ndjson.zst', uploadedMarkerName('20260929')]
    expect(pendingDays([], archive, now)).toEqual([])
  })

  it('still lists an uploaded day whose hourly files survived a failed delete', () => {
    const archive = ['snap-20260929.ndjson.zst', uploadedMarkerName('20260929')]
    expect(pendingDays(hours('20260929', '11'), archive, now)).toEqual(['20260929'])
  })

  it('ignores unrelated files', () => {
    expect(pendingDays(['collector.log', 'snap-2026-bad.gz'], ['notes.txt'], now)).toEqual([])
  })
})
