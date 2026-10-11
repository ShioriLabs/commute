package id.shiorilabs.commute.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.font.PlusJakartaSansFontFamily

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

/** OpenType `tnum`: figures of one width, so a clock or a count doesn't shift as it changes. */
const val TABULAR = "tnum"
