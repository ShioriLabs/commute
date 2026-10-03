package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One pulse, Tailwind's `animate-pulse` at 1.2 s: down to half opacity and back. */
private const val PULSE_MILLIS = 1200

/** Each chevron starts this much after the one before it, so the three ripple. */
private const val PULSE_STAGGER_MILLIS = 180

/**
 * The arriving-now marker borrowed from KCI platform displays, which render an imminent departure as
 * `MANGGARAI  >>  17:52`. Decorative: the row's own description states the departure.
 */
@Composable
fun PidsChevrons(
    color: Color,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "pidsChevrons")

    Row(
        modifier = modifier.clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = 1f,
                targetValue = 1f,
                animationSpec = pulse(index),
                label = "pidsChevron$index",
            )
            Text(
                text = "›",
                modifier = Modifier.graphicsLayer { this.alpha = alpha },
                color = color,
                fontSize = 16.sp,
                fontWeight = FontWeight.Black,
                lineHeight = 16.sp,
            )
        }
    }
}

/**
 * The chevrons as a progress meter, for a pull to refresh: dim at rest, each lighting in turn as
 * [progress] runs from 0 to 1, as though the train were drawing in. [pulsing] ripples them as
 * [PidsChevrons] does, for the wait once the pull has let go. [progress] is read at draw time, so
 * a drag redraws without recomposing; nothing animates on its own unless [pulsing].
 *
 * Drawn as shapes rather than set as text, in the glyph's flat-ended form: a "›" sits at x-height
 * in a line box that leaves room above for capitals, so as text it can't be centred in anything.
 * [height] is one chevron's; the row is [CHEVRON_ROW_ASPECT] times as wide.
 */
@Composable
fun PidsChevronsProgress(
    progress: () -> Float,
    pulsing: Boolean,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 10.dp,
) {
    val pulses = if (pulsing) {
        val transition = rememberInfiniteTransition(label = "pidsChevronsProgress")
        List(3) { index ->
            transition.animateFloat(
                initialValue = 1f,
                targetValue = 1f,
                animationSpec = pulse(index),
                label = "pidsChevronProgress$index",
            )
        }
    } else {
        null
    }
    Spacer(
        modifier = modifier
            .clearAndSetSemantics { }
            .size(width = height * CHEVRON_ROW_ASPECT, height = height)
            .drawWithCache {
                val chevronHeight = size.height
                val chevronWidth = chevronHeight * CHEVRON_ASPECT
                val chevron = chevronPath(chevronWidth, chevronHeight)
                val step = chevronWidth + chevronHeight * CHEVRON_GAP
                onDrawBehind {
                    repeat(3) { index ->
                        val alpha = pulses?.get(index)?.value ?: litAlpha(progress(), index)
                        translate(left = index * step) {
                            drawPath(chevron, color.copy(alpha = color.alpha * alpha))
                        }
                    }
                }
            },
    )
}

/** How lit chevron [index] of three is at [progress]: dim until its third of the pull, then full. */
internal fun litAlpha(progress: Float, index: Int): Float =
    UNLIT_ALPHA + (1f - UNLIT_ALPHA) * (progress * 3 - index).coerceIn(0f, 1f)

private const val UNLIT_ALPHA = 0.2f

// One chevron's proportions, to its height, after Plus Jakarta Sans Black's "›".
private const val CHEVRON_ASPECT = 0.75f
private const val CHEVRON_STROKE = 0.42f
private const val CHEVRON_GAP = 0.4f

/** How much wider than one chevron's height the row of three is. */
private const val CHEVRON_ROW_ASPECT = 3 * CHEVRON_ASPECT + 2 * CHEVRON_GAP

/** A chevron pointing right with flat, horizontal ends, filling [width] × [height]. */
private fun chevronPath(width: Float, height: Float): Path {
    val stroke = height * CHEVRON_STROKE
    return Path().apply {
        moveTo(0f, 0f)
        lineTo(stroke, 0f)
        lineTo(width, height / 2)
        lineTo(stroke, height)
        lineTo(0f, height)
        lineTo(width - stroke, height / 2)
        close()
    }
}

/**
 * The same pulse as one chevron, for anything else that marks a departure leaving now: the full
 * timetable's next row. Read it inside `graphicsLayer`, so the pulse redraws without recomposing.
 */
@Composable
fun rememberPulseAlpha(): State<Float> =
    rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = pulse(0),
        label = "pulseAlpha",
    )

private fun pulse(index: Int): InfiniteRepeatableSpec<Float> = infiniteRepeatable(
    animation = keyframes {
        durationMillis = PULSE_MILLIS
        1f at 0 using LinearEasing
        0.5f at PULSE_MILLIS / 2 using LinearEasing
        1f at PULSE_MILLIS
    },
    repeatMode = RepeatMode.Restart,
    initialStartOffset = StartOffset(index * PULSE_STAGGER_MILLIS),
)
