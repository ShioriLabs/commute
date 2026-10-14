# Android: HyperOS ignores variable-font weight

**Status:** known, not fixed (decided 2026-10-14: non-mainline devices, no complaints).

## Symptom

On Xiaomi HyperOS (reported by a tester), every text weight renders as the base weight. Bold labels
(e.g. the trip reminder sheet rows, `Reminder.kt`) look the same as Medium body text. Other phones
render the weights correctly.

## Cause

`core/font/Fonts.kt` bundles one variable file, `plus_jakarta_sans.ttf` (`wght` axis 200-800,
default 400), and each `FontWeight` is a `FontVariation.weight(...)` instance of it. That relies on
the OS honouring `setFontVariationSettings` for app resource fonts. AOSP does; HyperOS's font engine
(MiSans-based) appears not to, so every weight falls back to the default instance. Other OEM skins
(MIUI, ColorOS, OriginOS) may behave the same; unverified. minSdk is 29, so not an old-API issue.

## Fix, if it ever matters

Replace the variable file with static per-weight TTFs and declare each as its own `Font(resId,
weight)`:

1. `python -m fontTools.varLib.instancer plus_jakarta_sans.ttf wght=<w> -o plus_jakarta_sans_<name>.ttf`
   for 400/500/600/700/800 (Regular, Medium, SemiBold, Bold, ExtraBold).
2. Delete the variable file; drop `FontVariation` from `Fonts.kt`.
3. Un-instanced files are ~96 KB each (~480 KB vs 176 KB). Subset to the Latin ranges in use, as the
   roundel fonts are, to land around 40-50 KB each.

Tried and verified to build on 2026-10-14, then reverted. Not device-tested on HyperOS.

## Alternatives rejected

- Ship both sets, pick by `Build.MANUFACTURER`: both still ship in the APK (no saving), and brand
  checks are brittle.
- Runtime probe (measure Regular vs Bold width, fall back to static): works, but adds startup code
  to guard a size difference.
