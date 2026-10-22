package id.shiorilabs.commute.core.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * The Tailwind shades the web draws in, named as there, so a class on the web reads straight across
 * to a colour here. Only opaque shades; a feature keeps its own `/70`-style variants beside it.
 *
 * Each shade is the one the light theme draws, and on the dark themes (see [LocalDarkTheme]) its
 * mirror: Slate900 text is Slate100, a Slate100 fill is Slate800, and so on up and down the scale,
 * so what was ink stays ink and what was paper stays paper. They are read inside composition; a
 * fixed colour that must not follow the theme (a physical sign's own plate) is the [Fixed] one.
 */

private val Slate100Light = Color(0xFFF1F5F9)
private val Slate200Light = Color(0xFFE2E8F0)
private val Slate300Light = Color(0xFFCBD5E1)
private val Slate400Light = Color(0xFF94A3B8)
private val Slate500Light = Color(0xFF64748B)
private val Slate600Light = Color(0xFF475569)
private val Slate700Light = Color(0xFF334155)
private val Slate800Light = Color(0xFF1E293B)
private val Slate900Light = Color(0xFF0F172A)

private val Gray500Light = Color(0xFF6B7280)
private val Gray600Light = Color(0xFF4B5563)
private val Gray700Light = Color(0xFF374151)

private val Rose50Light = Color(0xFFFFF1F2)
private val Rose100Light = Color(0xFFFFE4E6)
private val Rose200Light = Color(0xFFFECDD3)
private val Rose300Light = Color(0xFFFDA4AF)
private val Rose500Light = Color(0xFFF43F5E)
private val Rose700Light = Color(0xFFBE123C)

private val Pink800Light = Color(0xFF9D174D)

private val Amber100Light = Color(0xFFFEF3C7)
private val Amber700Light = Color(0xFFB45309)
private val Amber800Light = Color(0xFF92400E)
private val Amber950Light = Color(0xFF451A03)

private val Blue500Light = Color(0xFF3B82F6)

private val Green700Light = Color(0xFF15803D)

/** A shade's light value, or its dark mirror on the dark themes. */
@Composable
private fun pick(light: Color, dark: Color): Color = if (LocalDarkTheme.current) dark else light

val Slate100: Color @Composable get() = pick(Slate100Light, Slate800Light)
val Slate200: Color @Composable get() = pick(Slate200Light, Slate700Light)
val Slate300: Color @Composable get() = pick(Slate300Light, Slate600Light)
val Slate400: Color @Composable get() = pick(Slate400Light, Slate500Light)
val Slate500: Color @Composable get() = pick(Slate500Light, Slate400Light)
val Slate600: Color @Composable get() = pick(Slate600Light, Slate300Light)
val Slate700: Color @Composable get() = pick(Slate700Light, Slate200Light)
val Slate800: Color @Composable get() = pick(Slate800Light, Slate100Light)
val Slate900: Color @Composable get() = pick(Slate900Light, Slate100Light)

val Gray500: Color @Composable get() = pick(Gray500Light, Slate400Light)
val Gray600: Color @Composable get() = pick(Gray600Light, Slate300Light)
val Gray700: Color @Composable get() = pick(Gray700Light, Slate200Light)

val Rose50: Color @Composable get() = pick(Rose50Light, Color(0xFF3A1220))
val Rose100: Color @Composable get() = pick(Rose100Light, Color(0xFF4C1527))
val Rose200: Color @Composable get() = pick(Rose200Light, Color(0xFF6B1D36))
val Rose300: Color @Composable get() = pick(Rose300Light, Rose300Light)
val Rose500: Color @Composable get() = pick(Rose500Light, Rose500Light)
val Rose700: Color @Composable get() = pick(Rose700Light, Rose300Light)

val Pink800: Color @Composable get() = pick(Pink800Light, Rose300Light)

val Amber100: Color @Composable get() = pick(Amber100Light, Color(0xFF4A3410))
val Amber700: Color @Composable get() = pick(Amber700Light, Color(0xFFFCD34D))
val Amber800: Color @Composable get() = pick(Amber800Light, Color(0xFFFDE68A))
val Amber950: Color @Composable get() = pick(Amber950Light, Amber100Light)

val Blue500: Color @Composable get() = pick(Blue500Light, Blue500Light)

val Green700: Color @Composable get() = pick(Green700Light, Color(0xFF4ADE80))

/**
 * The shades as the light theme draws them whatever the theme is, for what is outside it: a line's
 * fallback grey, the plate of a physical sign, anything read outside composition.
 */
object Fixed {

    val Slate100 = Slate100Light
    val Slate200 = Slate200Light
    val Slate300 = Slate300Light
    val Slate400 = Slate400Light
    val Slate500 = Slate500Light
    val Slate600 = Slate600Light
    val Slate700 = Slate700Light
    val Slate800 = Slate800Light
    val Slate900 = Slate900Light
}

/** [light] on the light theme, [dark] on the dark ones. */
@Composable
fun themed(light: Color, dark: Color): Color = pick(light, dark)

/**
 * The Jak Lingko colour roles for a way out: yellow means "exit" and nothing else, on the near-black
 * every MRT, BRT and LRT sign uses. The same on every theme, as a sign is.
 */
val ExitYellow = Color(0xFFF9D437)
val SignageNavy = Color(0xFF0C1B2A)

/** The translucent stone the web fills fields and plates with, as white on dark; a hairline is a touch stronger. */
val StoneFillDark = Color(0x1AFFFFFF)
val StoneLineDark = Color(0x33FFFFFF)

/** The ground a page is drawn on: white on the light theme, the theme's lowest surface otherwise. */
val PageGround: Color @Composable get() = MaterialTheme.colorScheme.surfaceContainerLowest

/** The white of a card or plate on the light theme; the dark themes' card surface otherwise. */
val Paper: Color @Composable get() = pick(Color.White, MaterialTheme.colorScheme.surfaceContainer)
