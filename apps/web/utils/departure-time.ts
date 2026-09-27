/*
 * Departure times, on the grid the cache can actually distinguish.
 *
 * The API keys journey answers on a 20-minute slot (see the API's
 * `departureSlot`), so times between slot boundaries are not a finer answer —
 * they are the same answer under a colder key. Everything here quantises to
 * that grid rather than pretending any minute is on offer.
 *
 * Local time throughout, deliberately. The app is Jakarta-only and every other
 * rider-facing clock (`formatClock`, the departure boards) reads the WIB wall
 * clock, so a picker working in UTC would offer times nobody recognises. The
 * ISO strings that leave here carry the device's offset and the server parses
 * them as instants, which is the same contract `at` has always had.
 */

/** Must match the API's DEPARTURE_SLOT_MINUTES, which keys the journey cache. */
export const DEPARTURE_SLOT_MINUTES = 20

/** How many days ahead the picker offers, today included. */
const DAYS_OFFERED = 7

/**
 * The slot a moment falls in, floored.
 *
 * Floors rather than rounds for the same reason the server does: a time must
 * never key to a slot that has not started, or a rider asking for 08.39 is
 * quoted the 08.40 departures and misses the one they meant.
 */
export function quantiseToSlot(date: Date): Date {
  const slotted = new Date(date)
  slotted.setMinutes(Math.floor(date.getMinutes() / DEPARTURE_SLOT_MINUTES) * DEPARTURE_SLOT_MINUTES, 0, 0)
  return slotted
}

/** The hours a wheel offers, 0 through 23. */
export const DEPARTURE_HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/**
 * The minutes a wheel offers: slot boundaries only.
 *
 * The reference apps step by one or five, but their backends answer per minute.
 * Ours keys on DEPARTURE_SLOT_MINUTES, so an off-grid minute is not a finer
 * answer — it is the same answer shown under a time the rider did not get. A
 * short wheel that never lies beats a long one that quietly floors.
 */
export const DEPARTURE_MINUTES = Array.from(
  { length: 60 / DEPARTURE_SLOT_MINUTES },
  (_, index) => index * DEPARTURE_SLOT_MINUTES
)

/** A day plus a wall-clock time, as the instant the query will carry. */
export function composeDeparture(day: Date, hour: number, minute: number): Date {
  const at = new Date(day)
  at.setHours(hour, minute, 0, 0)
  return at
}

/**
 * The same departure, nudged by whole slots.
 *
 * Takes `'now'` as a starting point rather than refusing it: nudging from the
 * default is how a rider says "a bit later than now" without first picking an
 * absolute time, and the current slot is what `'now'` already means to the
 * cache.
 */
export function shiftBySlot(value: string, slots: number, now: Date = new Date()): Date {
  const base = value === 'now' ? quantiseToSlot(now) : quantiseToSlot(new Date(value))
  return new Date(base.getTime() + slots * DEPARTURE_SLOT_MINUTES * 60_000)
}

/** Today and the next few days, each at local midnight. */
export function departureDays(from: Date = new Date()): Date[] {
  const days: Date[] = []
  const midnight = new Date(from)
  midnight.setHours(0, 0, 0, 0)
  for (let index = 0; index < DAYS_OFFERED; index += 1) {
    const day = new Date(midnight)
    day.setDate(midnight.getDate() + index)
    days.push(day)
  }
  return days
}

/** Whether two instants land on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

/**
 * A day as a rider names it: "Hari ini", "Besok", else a short date.
 *
 * Relative wording only for the two days that have a common name. "Lusa" is
 * ambiguous enough in casual use that a date is clearer, and past day three
 * nobody counts in days anyway.
 */
export function formatDepartureDay(day: Date, now: Date = new Date()): string {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const target = new Date(day)
  target.setHours(0, 0, 0, 0)
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Hari ini'
  if (diffDays === 1) return 'Besok'
  return target.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * The departure button's face: when this journey leaves.
 *
 * `'now'` is a mode rather than a time, so it reads as words. A picked instant
 * names its day only when that day is not today — "Besok 08.40" is worth four
 * extra characters, "Hari ini 08.40" is not.
 */
export function formatDepartureLabel(value: string, now: Date = new Date()): string {
  if (value === 'now') return 'Sekarang'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return 'Sekarang'
  const clock = `${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}`
  return isSameLocalDay(at, now) ? clock : `${formatDepartureDay(at, now)} ${clock}`
}

/**
 * How long until a picked departure stops being current, in milliseconds.
 *
 * A departure is good until its own slot ends, which is the grid the cache can
 * distinguish — so this is the instant plus one slot, not the instant itself.
 * Callers arm a timer with it to follow the clock across that boundary while a
 * page sits open; see useFareQuery.
 *
 * Floored to a second so a boundary case cannot schedule into the past and spin
 * a timer that fires immediately and re-arms forever. `'now'` and an
 * unparseable value have no boundary to wait for and return null — `'now'`
 * already follows the clock, and a broken instant is dropped on read rather
 * than waited on.
 */
export function msUntilDepartureStale(value: string, now: Date = new Date()): number | null {
  if (value === 'now') return null
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return null
  const slotMs = DEPARTURE_SLOT_MINUTES * 60_000
  return Math.max(1_000, at.getTime() + slotMs - now.getTime())
}

/**
 * Whether a stored departure has been overtaken by the clock.
 *
 * A stored instant is a promise about a journey the rider was planning; once it
 * is in the past that promise is stale, and pricing a departure nobody can
 * board is worse than quietly following the clock again. Checked against the
 * slot rather than the instant so the current slot stays valid until it ends.
 */
export function isStaleDeparture(value: string, now: Date = new Date()): boolean {
  if (value === 'now') return false
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return true
  return at.getTime() < quantiseToSlot(now).getTime()
}
