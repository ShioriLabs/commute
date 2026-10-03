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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
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
