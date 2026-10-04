package id.shiorilabs.commute.core.ui.motion

import androidx.compose.animation.core.CubicBezierEasing

/**
 * The web's `--ease-ios-spring`: off at speed, and it settles into place rather than crawling the
 * last few pixels. The app's curve for anything that arrives.
 */
val IosSpringEasing = CubicBezierEasing(0.36f, 0.66f, 0.04f, 1f)
