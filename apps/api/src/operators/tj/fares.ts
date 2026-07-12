/*
 * TransJakarta fares. TJ charges a flat Rp 3.500 per journey-chain within a
 * 3-hour transfer window (fares-v1 FP/FP2 in the feed) — route-based, no zones.
 * The chain-collapse (multiple TJ legs within the window count once) belongs in
 * fare-summary once multi-operator TJ journeys exist. Stub until then; see
 * docs/tj-gtfs-import.md.
 */
export const TJ_FLAT_FARE = 3500
