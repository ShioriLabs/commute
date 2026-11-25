import { describe, expect, it } from 'vitest'
import { hubPageTitle, linePageTitle, stationPageTitle, timetablePageTitle } from './page-titles'

/*
 * Google indexes these, not the middleware's crawler titles, because it runs
 * the SPA. Station results read "Rawa Buaya - Commute" until the titles
 * carried the search words ("Jadwal KRL").
 */
describe('page titles', () => {
  it('leads station titles with the mode people search', () => {
    expect(stationPageTitle('KCI', 'Rawa Buaya', 'RW')).toBe('Jadwal KRL Stasiun Rawa Buaya - Commute')
    expect(stationPageTitle('MRTJ', 'Blok M BCA', 'BLM')).toBe('Jadwal MRT Stasiun Blok M BCA - Commute')
    expect(stationPageTitle('TJ', 'Bundaran HI', 'X')).toBe('Jadwal TransJakarta Halte Bundaran HI - Commute')
  })

  it('falls back to the code before the station loads, and folds operator case', () => {
    expect(stationPageTitle('kci', null, 'rw')).toBe('Jadwal KRL RW - Commute')
    expect(timetablePageTitle('KCI', null, 'rw')).toBe('Jadwal Lengkap KRL RW - Commute')
  })

  it('titles the full timetable', () => {
    expect(timetablePageTitle('KCI', 'Duri', 'DU')).toBe('Jadwal Lengkap KRL Stasiun Duri - Commute')
  })

  it('puts the route number ahead of TransJakarta termini', () => {
    expect(linePageTitle('KCI', 'T', 'Lin Tangerang')).toBe('Jadwal & Rute KRL Lin Tangerang - Commute')
    expect(linePageTitle('TJ', '1', 'Blok M - Kota')).toBe('Jadwal & Rute TransJakarta 1 Blok M - Kota - Commute')
    expect(linePageTitle('KCI', 't', null)).toBe('Jadwal & Rute KRL T - Commute')
  })

  it('does not repeat "Halte" for a directional hub', () => {
    expect(hubPageTitle('Dukuh Atas', 'hub')).toBe('Jadwal Kereta Dukuh Atas - Pumpunan Moda - Commute')
    expect(hubPageTitle('Juanda', 'integrated')).toBe('Jadwal Kereta Juanda - Stasiun Terintegrasi - Commute')
    expect(hubPageTitle('Senen', 'directional')).toBe('Jadwal Bus Halte Senen - Commute')
  })
})
