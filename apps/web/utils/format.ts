/*
 * Number formatting for rider-facing figures.
 *
 * One module because these are the numbers the whole product is about: two
 * `Intl.NumberFormat` instances for rupiah is two chances to disagree on
 * rounding, and the fare sheet and the summary strip sit on the same screen.
 */

// Whole rupiah. Fares are never fractional, and a stray ",00" reads as a
// precision the tariff does not have.
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

export function formatRupiah(amount: number): string {
  // formatToParts, not .format(): the id-ID currency style inserts a
  // non-breaking space between "Rp" and the digits, which is not the
  // official convention (RpX.XXX, no gap).
  return rupiah
    .formatToParts(amount)
    .filter(part => part.type !== 'literal' || part.value.trim() !== '')
    .map(part => part.value)
    .join('')
}

// One decimal place: metres are what the API carries, kilometres are what a
// rider reads, and a second decimal is noise at walking scale.
export function formatKm(distanceM: number): string {
  return `${(distanceM / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
}

/*
 * A wall clock from an ISO instant, as 07.14.
 *
 * `id-ID` uses a dot rather than a colon, which is what the station departure
 * board and the timetable already render — one convention across every surface
 * that shows a time.
 *
 * The timezone is pinned to Asia/Jakarta rather than left to the device. The
 * API stamps +07:00 explicitly, and a rider abroad checking a Jakarta journey
 * wants the time they will read off the platform sign, not their own.
 */
export function formatClock(isoInstant: string): string {
  return new Date(isoInstant).toLocaleTimeString('id-ID', {
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta'
  })
}
