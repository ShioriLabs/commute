package id.shiorilabs.commute.feature.journey.presentation.components

import id.shiorilabs.commute.core.ui.theme.themed
import id.shiorilabs.commute.core.ui.theme.StoneLineDark
import id.shiorilabs.commute.core.ui.theme.StoneFillDark
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * The fare sheet's see-through stone shades, named after the web's classes. Its opaque Tailwind shades
 * are core:ui's palette.
 */

/** `bg-stone-100/80`, the fields' and breakdown rows' ground. */
internal val Stone100: Color
    @Composable get() = themed(Color(0xCCF5F5F4), StoneFillDark)

/** `bg-stone-100/60`, a journey option's plate. */
internal val OptionPlate: Color
    @Composable get() = themed(Color(0x99F5F5F4), StoneFillDark)

/** `border-stone-200/70`, the chips' and fields' outline. */
internal val Stone200: Color
    @Composable get() = themed(Color(0xB3E7E5E4), StoneLineDark)

