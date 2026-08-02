import { OPERATORS } from '@commute/constants'
import type { PaymentMethod } from '@commute/constants'
import type { OperatorCode } from '@commute/schemas'
import type { FareCriteria } from 'utils/fare-criteria'

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

export const FARE_TIME_LABELS: Record<FareCriteria['fareTime'], string> = {
  now: 'Sekarang',
  peak: 'Jam Sibuk',
  offpeak: 'Di Luar Jam Sibuk'
}

export const FARE_TIME_DESCRIPTIONS: Record<FareCriteria['fareTime'], string> = {
  now: 'Tarif dihitung buat jam sekarang',
  // Naming the operator matters: this is the only place the bucket changes the
  // number, so a rider who never touches LRT Jabodebek should see that it will
  // not affect them rather than wonder why nothing moved.
  peak: 'Senin sampai Jumat, 07.00 sampai 09.00 dan 16.00 sampai 19.00. Batas tarif LRT Jabodebek naik jadi Rp 20.000',
  offpeak: 'Di luar jam sibuk dan akhir pekan. Batas tarif LRT Jabodebek Rp 10.000'
}

/**
 * Operators present in a station list, in canonical OPERATORS order.
 *
 * Lives here rather than in criteria-bar.tsx so it is testable: the vitest
 * config collects `.test.ts` only, so logic in a `.tsx` cannot be covered.
 */
export function operatorsPresent(stations: { operator: OperatorCode }[]): OperatorCode[] {
  const present = new Set(stations.map(station => station.operator))
  return (Object.keys(OPERATORS) as OperatorCode[]).filter(code => present.has(code))
}

/** `null` means the picker offers every operator. */
export function operatorLabel(code: OperatorCode | null): string {
  if (!code) return 'Semua'
  return OPERATORS[code]?.name ?? code
}
