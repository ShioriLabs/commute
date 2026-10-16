package id.shiorilabs.commute.core.ui.theme

import android.app.Activity
import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import id.shiorilabs.commute.core.datastore.ThemeMode
import id.shiorilabs.commute.core.ui.motion.PressFeedback

private val lightScheme = with(CommuteColors) {
    lightColorScheme(
        primary = primaryLight,
        onPrimary = onPrimaryLight,
        primaryContainer = primaryContainerLight,
        onPrimaryContainer = onPrimaryContainerLight,
        secondary = secondaryLight,
        onSecondary = onSecondaryLight,
        secondaryContainer = secondaryContainerLight,
        onSecondaryContainer = onSecondaryContainerLight,
        tertiary = tertiaryLight,
        onTertiary = onTertiaryLight,
        tertiaryContainer = tertiaryContainerLight,
        onTertiaryContainer = onTertiaryContainerLight,
        error = errorLight,
        onError = onErrorLight,
        errorContainer = errorContainerLight,
        onErrorContainer = onErrorContainerLight,
        background = backgroundLight,
        onBackground = onBackgroundLight,
        surface = surfaceLight,
        onSurface = onSurfaceLight,
        surfaceVariant = surfaceVariantLight,
        onSurfaceVariant = onSurfaceVariantLight,
        outline = outlineLight,
        outlineVariant = outlineVariantLight,
        scrim = scrimLight,
        inverseSurface = inverseSurfaceLight,
        inverseOnSurface = inverseOnSurfaceLight,
        inversePrimary = inversePrimaryLight,
        surfaceDim = surfaceDimLight,
        surfaceBright = surfaceBrightLight,
        surfaceContainerLowest = surfaceContainerLowestLight,
        surfaceContainerLow = surfaceContainerLowLight,
        surfaceContainer = surfaceContainerLight,
        surfaceContainerHigh = surfaceContainerHighLight,
        surfaceContainerHighest = surfaceContainerHighestLight,
    )
}

private val navyScheme = with(NavyColors) {
    darkColorScheme(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = primaryContainer,
        onPrimaryContainer = onPrimaryContainer,
        secondary = secondary,
        onSecondary = onSecondary,
        secondaryContainer = secondaryContainer,
        onSecondaryContainer = onSecondaryContainer,
        tertiary = tertiary,
        onTertiary = onTertiary,
        tertiaryContainer = tertiaryContainer,
        onTertiaryContainer = onTertiaryContainer,
        error = error,
        onError = onError,
        errorContainer = errorContainer,
        onErrorContainer = onErrorContainer,
        background = background,
        onBackground = onBackground,
        surface = surface,
        onSurface = onSurface,
        surfaceVariant = surfaceVariant,
        onSurfaceVariant = onSurfaceVariant,
        outline = outline,
        outlineVariant = outlineVariant,
        scrim = scrim,
        inverseSurface = inverseSurface,
        inverseOnSurface = inverseOnSurface,
        inversePrimary = inversePrimary,
        surfaceDim = surfaceDim,
        surfaceBright = surfaceBright,
        surfaceContainerLowest = surfaceContainerLowest,
        surfaceContainerLow = surfaceContainerLow,
        surfaceContainer = surfaceContainer,
        surfaceContainerHigh = surfaceContainerHigh,
        surfaceContainerHighest = surfaceContainerHighest,
    )
}

private val blackScheme = with(BlackColors) {
    navyScheme.copy(
        background = background,
        surface = surface,
        surfaceVariant = surfaceVariant,
        secondaryContainer = secondaryContainer,
        outlineVariant = outlineVariant,
        surfaceDim = surfaceDim,
        surfaceBright = surfaceBright,
        surfaceContainerLowest = surfaceContainerLowest,
        surfaceContainerLow = surfaceContainerLow,
        surfaceContainer = surfaceContainer,
        surfaceContainerHigh = surfaceContainerHigh,
        surfaceContainerHighest = surfaceContainerHighest,
    )
}

/** What the app wears once the phone's night setting has been looked at: never "System". */
enum class ThemeLook { Light, Dark, Black }

/** The look this mode comes to on a phone that is in night mode ([systemDark]) or not. */
fun ThemeMode.resolve(systemDark: Boolean): ThemeLook = when (this) {
    ThemeMode.System -> if (systemDark) ThemeLook.Dark else ThemeLook.Light
    ThemeMode.Light -> ThemeLook.Light
    ThemeMode.Dark -> ThemeLook.Dark
    ThemeMode.Black -> ThemeLook.Black
}

/** Whether the theme is a dark one, for the few things that can't read it off a colour token. */
val LocalDarkTheme = staticCompositionLocalOf { false }

/**
 * The Commute theme, in the given [look]: the web's light palette, JakLingko navy, or black.
 *
 * No ripples either: a pressed surface doesn't darken. Taps answer with [PressFeedback] instead, a
 * slight shrink and blur, as every `clickable`'s indication. The null ripple configuration is for
 * Material's own components, which draw a ripple of their own; the app's buttons are
 * `CommuteButton` and `CommuteIconButton` so that they get the feedback too.
 */
@Composable
fun CommuteTheme(
    look: ThemeLook = ThemeLook.Light,
    content: @Composable () -> Unit,
) {
    val dark = look != ThemeLook.Light
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val insetsController = WindowCompat.getInsetsController(window, view)

            insetsController.isAppearanceLightStatusBars = !dark
            insetsController.isAppearanceLightNavigationBars = !dark
        }
    }

    val colorScheme = when (look) {
        ThemeLook.Light -> lightScheme
        ThemeLook.Dark -> navyScheme
        ThemeLook.Black -> blackScheme
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = CommuteShapes,
    ) {
        CompositionLocalProvider(
            LocalDarkTheme provides dark,
            // What text with no colour of its own is drawn in, outside a Surface: black, as ever, on light.
            LocalContentColor provides if (dark) colorScheme.onBackground else Color.Black,
            LocalIndication provides PressFeedback,
            LocalRippleConfiguration provides null,
            content = content,
        )
    }
}
