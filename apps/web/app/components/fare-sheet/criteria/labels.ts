import type { PaymentMethod } from '@commute/constants'
import type { FareCriteria, WalkingPreference } from 'utils/fare-criteria'

/*
 * Display strings for the criteria bar and its sheets.
 *
 * Separate from utils/fare-criteria.ts so the storage module stays free of
 * presentation, and so completeness is a compile-time check: these are typed
 * `Record<PaymentMethod, …>` rather than partials, so adding a payment method to
 * @commute/constants breaks the build here instead of quietly rendering a raw
 * enum to a rider.
 */

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  STORED_VALUE: 'Kartu Uang Elektronik',
  JAKLINGKO: 'JakLingko',
  QRIS_TAP: 'QRIS Tap'
}

export const PAYMENT_METHOD_DESCRIPTIONS: Record<PaymentMethod, string> = {
  STORED_VALUE: 'Kartu bank kayak Flazz, e-Money, Brizzi, atau TapCash, atau KMT-nya Commuter Line',
  JAKLINGKO: 'Tarif integrasi antar MRT, LRT Jakarta, dan TransJakarta',
  QRIS_TAP: 'Bayar pakai QRIS Tap dari e-wallet kayak GoPay atau mobile banking kayak myBCA'
}

/*
 * Which methods the sheet offers.
 *
 * JakLingko is deliberately absent. apps/api/src/utils/fare-summary.ts documents
 * its cap as KNOWN-INCORRECT: it sums per-operator tariffs and clamps at 10.000
 * where the real Tarif Integrasi is min(2500 + 250/km, 10000), so the official
 * worked example returns 10.000 against a correct 6.500. Today that bug is
 * invisible because nothing in the app ever sends `paymentMethod=JAKLINGKO`;
 * listing it here would make a known-wrong number selectable and, worse, put it
 * in a shareable URL. Add it back with the formula, not before.
 */
export const OFFERED_PAYMENT_METHODS: PaymentMethod[] = ['STORED_VALUE', 'QRIS_TAP']

/** What the departure button reads when the rider has not picked a time. */
export const DEPARTURE_NOW_LABEL = 'Berangkat sekarang'

/*
 * Which networks a route may use.
 *
 * "Semua" rather than "Semua moda": the chip already says Jalur, and the
 * shorter word is what a rider scanning a rail of chips actually reads.
 */
export const MODES_LABELS: Record<FareCriteria['modes'], string> = {
  all: 'Semua',
  rail: 'Tanpa TransJakarta'
}

/*
 * The rail-only description names the cost rather than selling the feature.
 * TransJakarta reaches most of the network and is the only way to LRT Jakarta,
 * so turning it off can leave a pair with no route at all, and a rider who is
 * told that up front reads an empty result as their own choice rather than a
 * broken app.
 */
export const MODES_DESCRIPTIONS: Record<FareCriteria['modes'], string> = {
  all: 'Pakai semua pilihan yang ada, termasuk TransJakarta',
  rail: 'Cuma kereta dan MRT/LRT. Beberapa rute jadi nggak ketemu, soalnya TransJakarta yang nyambungin'
}

/*
 * How much the rider minds walking.
 *
 * Named for the rider, not the multiplier: "how many times worse than riding is
 * a metre on foot" is not a question anyone can answer, while "I walk slowly"
 * is. AVERAGE reads as "Biasa aja" rather than "Rata-rata" — this is a habit,
 * not a statistic.
 */
export const WALKING_LABELS: Record<WalkingPreference, string> = {
  BRISK: 'Jalan cepat',
  AVERAGE: 'Biasa aja',
  SLOW: 'Jalan santai',
  AVOID: 'Males jalan'
}

/*
 * Never a duration. The engine has no duration model — `edges.durationSeconds`
 * is null on every row — so any wording like "5 menit lebih lama" would be a
 * promise it cannot keep. These describe what the ranking does instead.
 *
 * AVOID says "sebisanya", not "nggak akan", because the search still offers a
 * walking route when that is the only way through; it just ranks it last.
 */
export const WALKING_DESCRIPTIONS: Record<WalkingPreference, string> = {
  BRISK: 'Nggak masalah jalan jauh kalau transitnya jadi lebih sedikit',
  AVERAGE: 'Seimbang antara jalan kaki sama gonta-ganti kendaraan',
  SLOW: 'Lebih milih rute yang jalan kakinya pendek',
  AVOID: 'Hindari jalan kaki sebisanya, walau transitnya jadi lebih banyak'
}
