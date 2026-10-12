/*
 * Hourly boarding shares per operator: what fraction of a day's riders tap in
 * during each clock hour (WIB), index 0 = 00:00–00:59.
 *
 * Source: JakLingko Indonesia "jam_sibuk_per_pto" export, received 2026-10-05.
 * Only the SHAPE is committed. The export states no time window and counts only
 * JakLingko payers (≈ all MRT riders, ≈ 9% of TJ's, ≈ 1% of KCI's relative to
 * MRT), so its totals and cross-operator comparisons mean nothing outside
 * JakLingko and are deliberately not stored here.
 *
 * KCI's curve under-weights the morning: KCI's own releases put ~35% of a
 * normal weekday's boardings before 10:00 against 28.3% here. The correction
 * is applied in density/curves.ts (reweightMorning), not baked in, so this file
 * stays the source as received. See docs/station-density.md "KCI calibration".
 *
 * "LRT" in the export is taken to be LRT Jakarta. LRT Jabodebek has no curve
 * and borrows KCI's in the density generator.
 */
export const RIDER_CURVES = {
  MRTJ: [0.0001, 0.0001, 0.0, 0.0004, 0.0038, 0.0264, 0.0949, 0.1418, 0.0919, 0.0406, 0.0204, 0.0186, 0.0202, 0.0201, 0.0205, 0.032, 0.0756, 0.1357, 0.1046, 0.0621, 0.0402, 0.0297, 0.0171, 0.0029],
  KCI: [0.0005, 0.0, 0.0, 0.0019, 0.009, 0.0312, 0.0651, 0.0708, 0.0562, 0.0484, 0.0456, 0.043, 0.0452, 0.0429, 0.0437, 0.0517, 0.0693, 0.0907, 0.0816, 0.0647, 0.0529, 0.0424, 0.0349, 0.0081],
  LRTJ: [0.0008, 0.0003, 0.0001, 0.0002, 0.0005, 0.0087, 0.03, 0.0425, 0.047, 0.0499, 0.057, 0.0612, 0.0605, 0.0586, 0.0618, 0.074, 0.0839, 0.1148, 0.0856, 0.0613, 0.0494, 0.039, 0.0128, 0.0002],
  TJ: [0.0045, 0.0022, 0.0011, 0.0015, 0.0042, 0.0215, 0.0592, 0.0762, 0.0623, 0.0469, 0.041, 0.0411, 0.044, 0.0435, 0.0465, 0.058, 0.0768, 0.1015, 0.08, 0.0606, 0.0501, 0.0413, 0.0275, 0.0086]
} as const satisfies Record<string, readonly number[]>
