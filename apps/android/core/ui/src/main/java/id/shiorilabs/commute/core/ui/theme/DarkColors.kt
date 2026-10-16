package id.shiorilabs.commute.core.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The dark theme: JakLingko's signage navy (`#0C1B2A`) for the ground, lifted a step at a time for
 * each layer above it, with the same pink accent. See `docs/jaklingko-wayfinding.md`.
 */
object NavyColors {

    val primary = Color(0xFFF55875)
    val onPrimary = Color(0xFFFFFFFF)
    val primaryContainer = Color(0xFF5C1226)
    val onPrimaryContainer = Color(0xFFFFD9DF)

    val secondary = Color(0xFFCBD5E1)
    val onSecondary = Color(0xFF0F172A)
    val secondaryContainer = Color(0xFF1E3248)
    val onSecondaryContainer = Color(0xFFE2E8F0)

    val tertiary = Color(0xFF94A3B8)
    val onTertiary = Color(0xFF0F172A)
    val tertiaryContainer = Color(0xFF4A3410)
    val onTertiaryContainer = Color(0xFFFEF3C7)

    val error = Color(0xFFFFB4AB)
    val onError = Color(0xFF690005)
    val errorContainer = Color(0xFF93000A)
    val onErrorContainer = Color(0xFFFFDAD6)

    val background = Color(0xFF0C1B2A)
    val onBackground = Color(0xFFF1F5F9)
    val surface = Color(0xFF0C1B2A)
    val onSurface = Color(0xFFF1F5F9)
    val surfaceVariant = Color(0xFF1E3248)
    val onSurfaceVariant = Color(0xFFCBD5E1)

    val outline = Color(0xFF64748B)
    val outlineVariant = Color(0xFF1E3248)
    val scrim = Color(0xFF000000)

    val inverseSurface = Color(0xFFE2E8F0)
    val inverseOnSurface = Color(0xFF0F172A)
    val inversePrimary = Color(0xFFD6304F)

    val surfaceDim = Color(0xFF08141F)
    val surfaceBright = Color(0xFF223F5E)
    val surfaceContainerLowest = Color(0xFF08141F)
    val surfaceContainerLow = Color(0xFF102236)
    val surfaceContainer = Color(0xFF14293F)
    val surfaceContainerHigh = Color(0xFF1A3350)
    val surfaceContainerHighest = Color(0xFF213D5C)
}

/**
 * The black theme: the dark one with the navy taken out, for OLED screens where black is off. The
 * layers above the ground are near-black greys, so a card still reads against it.
 */
object BlackColors {

    val background = Color(0xFF000000)
    val surface = Color(0xFF000000)
    val surfaceVariant = Color(0xFF1C1C1E)
    val secondaryContainer = Color(0xFF1C1C1E)
    val outlineVariant = Color(0xFF262626)

    val surfaceDim = Color(0xFF000000)
    val surfaceBright = Color(0xFF2A2A2A)
    val surfaceContainerLowest = Color(0xFF000000)
    val surfaceContainerLow = Color(0xFF0A0A0A)
    val surfaceContainer = Color(0xFF111111)
    val surfaceContainerHigh = Color(0xFF181818)
    val surfaceContainerHighest = Color(0xFF202020)
}
