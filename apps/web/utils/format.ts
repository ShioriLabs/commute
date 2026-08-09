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
  return rupiah.format(amount)
}

// One decimal place: metres are what the API carries, kilometres are what a
// rider reads, and a second decimal is noise at walking scale.
export function formatKm(distanceM: number): string {
  return `${(distanceM / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
}
