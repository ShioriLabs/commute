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

/*
 * How long a journey takes, from two PUBLISHED times.
 *
 * The engine has no duration model — `edges.durationSeconds` is null on every
 * row — and the walking-preference copy is explicit that nothing may be worded
 * as a duration for exactly that reason (see criteria/labels.ts). This does not
 * breach that rule, it is the one case outside it: subtracting a timetabled
 * arrival from a timetabled departure is arithmetic on two figures the operator
 * published, not an estimate this app invented. Same distinction that let trip
 * times ship while `waitS` stayed off the wire entirely.
 *
 * So the caller must only reach here with a FULLY timed journey. A journey
 * missing one leg's times has no honest total, and the API already withholds
 * `arrivalAt` in that case — which is the check, rather than anything here.
 * The other figure worded as a duration is formatEstimate's, and it is marked.
 *
 * Plain minutes up to two hours, "120 mnt" included, and hours only past that:
 * rows are compared by eye, and "75 mnt" against "1 j 15 mnt" in the same
 * list would be two shapes for one fact. Abbreviated because this sits in a
 * meta row beside three other figures.
 */
export function formatDuration(fromIso: string, toIso: string): string {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  return minutesLabel(minutes)
}

/*
 * How long a TransJakarta ride or journey probably takes, from the API's
 * `estimate`: observed bus run times plus the expected wait, not a timetable.
 *
 * The ± is the whole point. It sits in the same slots formatDuration fills,
 * and without it a rider would read an estimate as the same kind of fact as a
 * train's published duration beside it. Never a clock: an arrival time is
 * exactly what nobody published for a bus.
 */
export function formatEstimate(seconds: number): string {
  return `±${minutesLabel(Math.max(1, Math.round(seconds / 60)))}`
}

// Past this, hours are split out; see formatDuration.
const MINUTES_ONLY_MAX = 120

function minutesLabel(minutes: number): string {
  if (minutes <= MINUTES_ONLY_MAX) return `${minutes} mnt`
  return `${Math.floor(minutes / 60)} j ${minutes % 60} mnt`
}
