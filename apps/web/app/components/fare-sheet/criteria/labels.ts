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

/*
 * The same methods, short enough to sit in a chip segment.
 *
 * "Kartu Uang Elektronik" is four words for the thing everyone calls a kartu;
 * KUE is what fits beside two other settings on one row and is how the card is
 * spoken about anyway. The long forms stay above for the sheet, where a rider
 * is choosing rather than checking.
 */
export const PAYMENT_METHOD_SHORT_LABELS: Record<PaymentMethod, string> = {
  STORED_VALUE: 'KUE',
  JAKLINGKO: 'JakLingko',
  QRIS_TAP: 'QRIS'
}

/*
 * Walking speed, as one word.
 *
 * "Pelan banget" loses its intensifier here: two words would be the only
 * wrapping segment on the row, and the pictogram beside it already carries the
 * tier in its speed lines.
 */
export const WALKING_SHORT_LABELS: Record<WalkingPreference, string> = {
  BRISK: 'Cepat',
  AVERAGE: 'Biasa',
  SLOW: 'Santai',
  SLOWEST: 'Pelan'
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
 * How fast the rider walks, after JR East's 歩く速度: はやい, ふつう, ゆっくり,
 * もっとゆっくり. Plain speed words, with no "jalan" prefix because the sheet
 * title already says what is being asked.
 */
export const WALKING_LABELS: Record<WalkingPreference, string> = {
  BRISK: 'Cepat',
  AVERAGE: 'Biasa',
  SLOW: 'Santai',
  SLOWEST: 'Pelan banget'
}

/*
 * When to pick each speed, not what it does. Also JR East's move: nobody knows
 * their pace in metres per second, but everyone knows whether they have done
 * this transfer before or are dragging a suitcase.
 *
 * Never a duration. Walk times are deliberately not shown for this setting, so
 * wording like "5 menit lebih lama" would promise a number the result never
 * displays.
 */
export const WALKING_DESCRIPTIONS: Record<WalkingPreference, string> = {
  BRISK: 'Udah hafal jalur transitnya',
  AVERAGE: 'Bisa jalan tanpa bingung cari arah',
  SLOW: 'Belum yakin sama jalur transitnya',
  SLOWEST: 'Lagi bawa barang gede, atau jalan bareng anak atau orang tua'
}
