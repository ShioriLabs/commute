package id.shiorilabs.commute.wear

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Typography

/**
 * The phone's palette turned out for a watch: black behind everything, as an OLED face wants, the
 * brand pink as the accent, slate for the surfaces the phone's trip board is plated in, and amber
 * for the trip asking something. Line colours are not here: they belong to the lines.
 */
private val CommuteWatchColors = ColorScheme(
    primary = Color(0xFFF55875),
    primaryDim = Color(0xFFD9466A),
    primaryContainer = Color(0xFF4C0519),
    onPrimary = Color(0xFFFFFFFF),
    onPrimaryContainer = Color(0xFFFFE4E6),
    secondary = Color(0xFFCBD5E1),
    secondaryDim = Color(0xFF94A3B8),
    secondaryContainer = Color(0xFF1E293B),
    onSecondary = Color(0xFF0F172A),
    onSecondaryContainer = Color(0xFFF1F5F9),
    tertiary = Color(0xFFFCD34D),
    tertiaryDim = Color(0xFFF59E0B),
    tertiaryContainer = Color(0xFF451A03),
    onTertiary = Color(0xFF451A03),
    onTertiaryContainer = Color(0xFFFEF3C7),
    surfaceContainerLow = Color(0xFF0F172A),
    surfaceContainer = Color(0xFF1E293B),
    surfaceContainerHigh = Color(0xFF334155),
    onSurface = Color(0xFFF8FAFC),
    onSurfaceVariant = Color(0xFFCBD5E1),
    outline = Color(0xFF64748B),
    outlineVariant = Color(0xFF334155),
    background = Color(0xFF000000),
    onBackground = Color(0xFFF8FAFC),
)

private fun plusJakartaSans(weight: FontWeight) = Font(
    resId = R.font.plus_jakarta_sans,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

/**
 * Plus Jakarta Sans, the phone's and the web's face; the same variable file as `:core:ui`'s, each
 * weight an instance of it.
 */
private val PlusJakartaSans = FontFamily(
    plusJakartaSans(FontWeight.Normal),
    plusJakartaSans(FontWeight.Medium),
    plusJakartaSans(FontWeight.SemiBold),
    plusJakartaSans(FontWeight.Bold),
    plusJakartaSans(FontWeight.ExtraBold),
)

/**
 * Wear's type scale in Plus Jakarta Sans. Every Wear style names the watch's own Roboto Flex, which
 * `defaultFontFamily` doesn't override, so each is set here; and untracked, as the phone sets it,
 * the face being wide already. The curved styles (the clock, the open-on-phone arc) stay the
 * watch's own.
 */
private val CommuteWatchTypography = Typography().run {
    fun TextStyle.commute() = copy(fontFamily = PlusJakartaSans, letterSpacing = 0.sp)
    Typography(
        displayLarge = displayLarge.commute(),
        displayMedium = displayMedium.commute(),
        displaySmall = displaySmall.commute(),
        titleLarge = titleLarge.commute(),
        titleMedium = titleMedium.commute(),
        titleSmall = titleSmall.commute(),
        labelLarge = labelLarge.commute(),
        labelMedium = labelMedium.commute(),
        labelSmall = labelSmall.commute(),
        bodyLarge = bodyLarge.commute(),
        bodyMedium = bodyMedium.commute(),
        bodySmall = bodySmall.commute(),
        bodyExtraSmall = bodyExtraSmall.commute(),
        numeralExtraLarge = numeralExtraLarge.commute(),
        numeralLarge = numeralLarge.commute(),
        numeralMedium = numeralMedium.commute(),
        numeralSmall = numeralSmall.commute(),
        numeralExtraSmall = numeralExtraSmall.commute(),
    )
}

@Composable
fun CommuteWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CommuteWatchColors,
        typography = CommuteWatchTypography,
        content = content,
    )
}
