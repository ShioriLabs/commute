import type { DensityRange, StationDensity } from '@commute/schemas'

/*
 * The badge is a forecast, so the copy says "biasanya" every time. The failure
 * we're avoiding is a rider trusting a green badge onto a packed platform: an
 * honestly labelled estimate survives being wrong, a fake live one doesn't.
 */
const WORDS = ['lengang', 'ramai', 'padat', 'sangat padat'] as const

const word = (level: number) => WORDS[Math.min(Math.max(level, 0), WORDS.length - 1)]!

/*
 * An open range is spelled out rather than collapsed to its top end: the model
 * is unsure there, and "padat sampai sangat padat" says so in the rider's terms.
 */
export function densityLabel(range: DensityRange | null): string | null {
  if (!range) return null
  if (range.min === range.max) return `Biasanya ${word(range.min)} jam segini`
  return `Biasanya ${word(range.min)} sampai ${word(range.max)} jam segini`
}

/** Clock hour on the device (the app already assumes WIB, like serviceDayOf). */
export function densityHour(now: Date): number {
  return now.getHours()
}

/*
 * The range for right now. The page fetches ?day=serviceDayOf(now), so after
 * midnight it already holds the previous service day's board; only the clock
 * hour is read here.
 */
export function currentHourRange(density: StationDensity | undefined, now: Date): DensityRange | null {
  return density?.hours[densityHour(now)]?.level ?? null
}
