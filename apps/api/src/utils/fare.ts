import { FareContext, HOLIDAYS, Operator, OPERATORS, SURCHARGED_CORRIDORS, SurchargedCorridor } from '@commute/constants'
import { getMRTJFare } from 'operators/mrtj/fares'
import { TJ_FLAT_FARE } from 'operators/tj/fares'
import type { RouteLeg } from '@commute/tsundere'

/*
 * Tariff rules per operator. All amounts in rupiah, all distances in metres.
 * Verified against official tariffs 2026-07-06:
 *  - KCI: progressive, 3000 for the first 25 km + 1000 per started 10 km.
 *  - LRTJ (LRT Jakarta): flat 5000.
 *  - LRTJBDB (LRT Jabodebek, KM 67/2023 jo. KM 70/2024): 5000 for the first
 *    km + 700 per started km, capped. The cap is time-dependent: 20000 at peak
 *    (weekday 07:00–09:00 & 16:00–19:00 WIB), 10000 off-peak/weekends. The cap
 *    is chosen from context.departureAt via fareTimeBucket.
 *  - MRTJ: published OD matrix (operators/mrtj/fares.ts).
 *  - TJ (TransJakarta): flat 3500 (TJ_FLAT_FARE). JakLingko integration caps the
 *    whole journey at JAKLINGKO_JOURNEY_CAP — handled at the journey level in
 *    summarizeFares, not here.
 *  - APCGK (Kalayang Bandara): free. Outside JakLingko entirely — it is not
 *    capped alongside the integrated operators, it simply costs nothing.
 */
export const KCI_BASE_FARE = 3000
export const LRTJBDB_FARE_CAP_PEAK = 20000
export const LRTJBDB_FARE_CAP_OFFPEAK = 10000
// JakLingko integration caps the MRTJ/LRTJ/TJ portion of a journey (within its
// 3-hour window) at this amount — single tier, any order, but only across the
// participating operators (JAKLINGKO_OPERATORS in @commute/constants; KCI and LRT
// Jabodebek are excluded and charged in full). Applied in summarizeFares via
// applyJakLingkoCap, only for paymentMethod === 'JAKLINGKO'.
export const JAKLINGKO_JOURNEY_CAP = 10000

export interface FareSegmentInput {
  operator: Operator
  distanceM: number
  fromStationCode: string
  toStationCode: string
}

/*
 * Coarse time bucket for fare purposes. LRT Jabodebek's cap is peak on weekdays
 * 07:00–09:00 and 16:00–19:00, off-peak otherwise (incl. weekends). Bucketing to
 * peak|offpeak — rather than raw time — keeps the fare cache small while staying
 * correct once the cap goes time-dependent (step 2). Times are WIB (UTC+7).
 */
export type FareTimeBucket = 'peak' | 'offpeak'

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

/*
 * The same instant, shifted so its UTC getters read as Jakarta wall-clock time.
 *
 * Shared by every caller that needs to know what day or hour it is locally.
 * A second copy of this shift is the kind of thing that drifts by an hour and
 * is noticed months later, so callers take this rather than redoing it.
 */
export function wib(date: Date): Date {
  return new Date(date.getTime() + WIB_OFFSET_MS)
}

export function fareTimeBucket(date: Date): FareTimeBucket {
  const local = wib(date)
  const day = local.getUTCDay() // 0 Sun … 6 Sat, in WIB after the shift
  if (day === 0 || day === 6) return 'offpeak'
  const hour = local.getUTCHours()
  const isPeak = (hour >= 7 && hour < 9) || (hour >= 16 && hour < 19)
  return isPeak ? 'peak' : 'offpeak'
}

/** How coarsely a departure time is quantised for cache purposes, in minutes. */
export const DEPARTURE_SLOT_MINUTES = 20

/**
 * A departure time as a quantised local slot, e.g. `0840`.
 *
 * The cache key's time component. `fareTimeBucket` used to fill that role, but
 * two buckets cannot express "the 08:42 train" — every instant in a three-hour
 * peak window collapsed to one entry, so a rider choosing a departure time got
 * whatever body the first caller of that window warmed.
 *
 * Twenty minutes is the compromise between those two failures. Per-minute keys
 * would split the namespace 1440 ways and miss on nearly every request; this
 * splits it 72 ways, which is cold enough to notice and warm enough to work.
 * The slot floors rather than rounds, so a time never keys to a slot that has
 * not started yet.
 *
 * Fare is NOT computed from this — `fareTimeBucket` still decides the LRT cap,
 * and must, because the cap genuinely is a peak/off-peak quantity. This only
 * decides what the cache treats as the same question, where a finer key is
 * always safe: it can split two identical answers, never merge two different
 * ones.
 */
export function departureSlot(date: Date): string {
  const local = wib(date)
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes()
  const slotStart = Math.floor(minuteOfDay / DEPARTURE_SLOT_MINUTES) * DEPARTURE_SLOT_MINUTES
  const hours = Math.floor(slotStart / 60)
  const minutes = slotStart % 60
  return `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`
}

/**
 * Which day bucket a moment falls in, Jakarta time.
 *
 * Indonesian public holidays run a Sunday-shaped service, so they resolve to
 * SUN rather than to the weekday they land on. The list is hand-maintained —
 * the TJ feed's `calendar_dates.txt` does not exist, so there is nothing to
 * import — and it degrades safely: a holiday nobody listed is simply treated as
 * whatever day of the week it is, which is exactly today's behaviour.
 */
export function serviceDay(date: Date): 'WD' | 'SAT' | 'SUN' {
  const local = wib(date)
  const iso = local.toISOString().slice(0, 10)
  if (HOLIDAYS.has(iso)) return 'SUN'
  const day = local.getUTCDay()
  if (day === 0) return 'SUN'
  if (day === 6) return 'SAT'
  return 'WD'
}

/**
 * A moment as a local (WIB) ISO 8601 string, e.g. `2026-09-06T05:00:00+07:00`.
 *
 * Written with the offset rather than as UTC because riders read this: "the bus
 * starts at 05:00" is the point, and a `Z` timestamp makes every consumer redo
 * the conversion to find that out.
 */
export function wibIsoString(date: Date): string {
  // The shifted clock's UTC fields ARE the Jakarta wall clock, so formatting
  // them and stamping the offset is exact rather than an approximation.
  return `${wib(date).toISOString().slice(0, 19)}+07:00`
}

/** Seconds since local (Jakarta) midnight — what the router filters on. */
export function secondsSinceLocalMidnight(date: Date): number {
  const local = wib(date)
  return local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds()
}

/**
 * The instant `secondsS` after the local midnight that `on` falls in.
 *
 * The inverse of `secondsSinceLocalMidnight`, and the reason it takes a whole
 * date rather than a day: the engine reports a journey that crosses midnight as
 * seconds past 86400 rather than wrapping to 00:23, so that "later" stays a
 * plain numeric comparison. Adding those seconds to local midnight rolls into
 * the next day on its own, which is exactly right — and it means a caller must
 * NOT take a modulus first, or a train arriving after midnight lands eleven
 * hours before the one it followed.
 */
export function atSecondsOfDay(on: Date, secondsS: number): Date {
  const local = wib(on)
  const midnightUTC = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  // Back out of the WIB shift, since `wib` moved the clock forward to read it.
  return new Date(midnightUTC + secondsS * 1000 - WIB_OFFSET_MS)
}

export function calculateSegmentFare(segment: FareSegmentInput, context: FareContext): number | null {
  const { operator, distanceM } = segment
  switch (operator) {
    case OPERATORS.KCI.code:
      return KCI_BASE_FARE + Math.max(0, Math.ceil((distanceM - 25000) / 10000)) * 1000
    case OPERATORS.LRTJ.code:
      return 5000
    case OPERATORS.LRTJBDB.code: {
      const cap = fareTimeBucket(context.departureAt) === 'peak'
        ? LRTJBDB_FARE_CAP_PEAK
        : LRTJBDB_FARE_CAP_OFFPEAK
      return Math.min(cap, 5000 + Math.max(0, Math.ceil((distanceM - 1000) / 1000)) * 700)
    }
    case OPERATORS.MRTJ.code:
      return getMRTJFare(segment.fromStationCode, segment.toStationCode)
    case OPERATORS.TJ.code:
      return TJ_FLAT_FARE
    /*
     * The airport Kalayang is free — every segment on FDTJ's poster is labelled
     * `0K`. Genuinely 0, not the Rp1 sentinel that marks a gate crossing on a
     * surcharged corridor: nobody taps and nothing is charged.
     *
     * This case is load-bearing rather than decorative. `default` below returns
     * null, and an unknown segment fare poisons the whole journey total (see
     * fare-summary.ts), so without it every trip through the airport would come
     * back unpriced.
     */
    case OPERATORS.APCGK.code:
      return 0
    default:
      return null
  }
}

// Direction-normalised lookup: router transfers are symmetric, so key on the
// sorted station-id pair.
const corridorKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const CORRIDOR_BY_KEY = new Map<string, SurchargedCorridor>(
  SURCHARGED_CORRIDORS.map(c => [corridorKey(c.stationIds[0], c.stationIds[1]), c])
)

// The transfer leg's immediate neighbours in journey order, so the surcharge
// check can tell whether the rider transited the gated station by train.
export interface TransferNeighbors {
  prev?: RouteLeg | null
  next?: RouteLeg | null
}

/*
 * A transfer's fare. Ordinary walking transfers are free (null); a transfer that
 * crosses a surcharged corridor (e.g. Dukuh Atas via KCI Sudirman's gated JPM
 * bridge) may carry a passerby surcharge that depends on payment method — card
 * taps get the discounted pass-through, QRIS_TAP pays the full fare.
 *
 * The surcharge only applies to a passerby who taps into/out of the gated station
 * on foot. If the leg adjacent to this transfer at the gated station is a
 * `throughOperator` RIDE, the rider transited by train and is already inside the
 * paid gates, so no extra tap happens → no surcharge (null). `neighbors` supplies
 * that adjacent leg; without it, the surcharge always applies.
 */
export function calculateTransferFare(
  fromStationId: string,
  toStationId: string,
  context: FareContext,
  neighbors?: TransferNeighbors
): { fare: number, corridor: SurchargedCorridor } | null {
  const corridor = CORRIDOR_BY_KEY.get(corridorKey(fromStationId, toStationId))
  if (!corridor) return null

  // The neighbour that shares the gated station: if the transfer departs the gate
  // (from === gated), the ride into it is `prev`; if it enters the gate
  // (to === gated), the ride out of it is `next`.
  const atGate = fromStationId === corridor.gatedStationId
    ? neighbors?.prev
    : toStationId === corridor.gatedStationId
      ? neighbors?.next
      : null
  if (atGate && atGate.type === 'RIDE' && atGate.operator === corridor.throughOperator) {
    return null // transited by train — already inside the gates, no passerby surcharge
  }

  const fare = context.paymentMethod === 'QRIS_TAP' ? corridor.fullFare : corridor.discountedFare
  return { fare, corridor }
}

/*
 * Per-leg display merge for the gated corridor. A surcharged corridor crossing
 * and an immediately-adjacent free walk on the gated-station side are physically
 * one interchange (e.g. LRT Dukuh Atas → [Rp1 gate crossing] → KCI Sudirman →
 * [free walk] → MRT Dukuh Atas). Edge distances are gate-to-gate, so the walk
 * *inside* the paid area (`internalWalkM`) is uncounted until we fold them.
 *
 * Returns, per leg index:
 *   { kind: 'MERGE_ANCHOR', distanceM, fare, corridor } — render one merged row
 *   { kind: 'ABSORBED' }   — the free walk folded into the anchor; skip it
 *   undefined              — ordinary leg, handle normally
 * The merge only fires for a *surcharged* corridor (waived corridors have no fee
 * and stay a plain walk) that actually has an adjacent free-walk transfer.
 */
export type CorridorMerge =
  | { kind: 'MERGE_ANCHOR', fromStationId: string, toStationId: string, distanceM: number, fare: number, corridor: SurchargedCorridor }
  | { kind: 'ABSORBED' }

export function resolveCorridorMerges(legs: RouteLeg[], context: FareContext): Map<number, CorridorMerge> {
  const merges = new Map<number, CorridorMerge>()
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (!leg || leg.type !== 'TRANSFER') continue
    const surcharge = calculateTransferFare(leg.fromStationId, leg.toStationId, context, {
      prev: legs[i - 1],
      next: legs[i + 1]
    })
    if (!surcharge) continue // free walk or waived corridor — no merge

    const corridor = surcharge.corridor
    // The gated station is one endpoint of the corridor leg; the chained free
    // walk is the transfer on the *other* side of that gated station.
    const gatedIsTo = leg.toStationId === corridor.gatedStationId
    const neighborIdx = gatedIsTo ? i + 1 : i - 1
    const neighbor = legs[neighborIdx]
    const chained = neighbor
      && neighbor.type === 'TRANSFER'
      && !calculateTransferFare(neighbor.fromStationId, neighbor.toStationId, context)
      && (gatedIsTo
        ? neighbor.fromStationId === corridor.gatedStationId
        : neighbor.toStationId === corridor.gatedStationId)

    if (chained) {
      // Span the outer endpoints in journey order: the corridor's non-gated end
      // and the free walk's non-gated end.
      const corridorOuter = gatedIsTo ? leg.fromStationId : leg.toStationId
      const walkOuter = gatedIsTo ? neighbor.toStationId : neighbor.fromStationId
      const [fromStationId, toStationId] = gatedIsTo
        ? [corridorOuter, walkOuter] // corridor then walk (forward order)
        : [walkOuter, corridorOuter] // walk then corridor (neighbor precedes)
      merges.set(i, {
        kind: 'MERGE_ANCHOR',
        fromStationId,
        toStationId,
        distanceM: leg.distanceM + neighbor.distanceM + (corridor.internalWalkM ?? 0),
        fare: surcharge.fare,
        corridor
      })
      merges.set(neighborIdx, { kind: 'ABSORBED' })
    }
  }
  return merges
}
