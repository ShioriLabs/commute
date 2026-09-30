package id.shiorilabs.commute.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.R

private fun plusJakartaSans(weight: FontWeight) = Font(
    resId = R.font.plus_jakarta_sans,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

/**
 * Plus Jakarta Sans, the UI face on web too. One variable-weight file is bundled and each weight
 * below is an instance of it, so adding a weight costs no download size. There is no italic: the
 * family has a separate italic file that is not bundled, and `FontStyle.Italic` would fall back to
 * a synthetic slant.
 */
val PlusJakartaSansFontFamily = FontFamily(
    plusJakartaSans(FontWeight.Normal),
    plusJakartaSans(FontWeight.Medium),
    plusJakartaSans(FontWeight.SemiBold),
    plusJakartaSans(FontWeight.Bold),
    plusJakartaSans(FontWeight.ExtraBold),
)

// Default Material 3 typography values
val baseline = Typography()

/**
 * Material's type scale is tuned for Roboto: it tracks its styles out (0.5sp on `bodyLarge`) and
 * sets body text at Normal. Plus Jakarta Sans is already a wide face, and the web app sets it
 * untracked at a base weight of 500, so every style here drops the tracking and starts from Medium
 * to match. Emphasis is still applied per call site (`FontWeight.SemiBold` / `Bold`).
 */
private fun TextStyle.commute() = copy(
    fontFamily = PlusJakartaSansFontFamily,
    fontWeight = FontWeight.Medium,
    letterSpacing = 0.sp,
)

val AppTypography = Typography(
    displayLarge = baseline.displayLarge.commute(),
    displayMedium = baseline.displayMedium.commute(),
    displaySmall = baseline.displaySmall.commute(),
    headlineLarge = baseline.headlineLarge.commute(),
    headlineMedium = baseline.headlineMedium.commute(),
    headlineSmall = baseline.headlineSmall.commute(),
    titleLarge = baseline.titleLarge.commute(),
    titleMedium = baseline.titleMedium.commute(),
    titleSmall = baseline.titleSmall.commute(),
    bodyLarge = baseline.bodyLarge.commute(),
    bodyMedium = baseline.bodyMedium.commute(),
    bodySmall = baseline.bodySmall.commute(),
    labelLarge = baseline.labelLarge.commute(),
    labelMedium = baseline.labelMedium.commute(),
    labelSmall = baseline.labelSmall.commute(),
)
