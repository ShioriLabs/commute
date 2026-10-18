package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate200
import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer

/** Placeholder blocks, the web's `bg-slate-200`. */
private val SkeletonColor: Color
    @Composable get() = Slate200

/** A placeholder block pulsing like the web's `animate-pulse`. [modifier] gives it its size. */
@Composable
fun SkeletonBlock(
    modifier: Modifier = Modifier,
    shape: Shape = MaterialTheme.shapes.medium,
) {
    val transition = rememberInfiniteTransition(label = "skeletonPulse")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = PulseSpec,
        label = "skeletonPulseAlpha",
    )
    Box(
        modifier
            .graphicsLayer { this.alpha = alpha }
            .background(SkeletonColor, shape),
    )
}

/** Tailwind's `animate-pulse`: down to half opacity and back over two seconds. */
private val PulseSpec: InfiniteRepeatableSpec<Float> = infiniteRepeatable(
    animation = keyframes {
        durationMillis = 2000
        1f at 0 using LinearEasing
        0.5f at 1000 using LinearEasing
        1f at 2000
    },
    repeatMode = RepeatMode.Restart,
)

@Preview(showBackground = true)
@Composable
private fun SkeletonBlockPreview() {
    CommutePreviewScaffold {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SkeletonBlock(Modifier.fillMaxWidth().height(24.dp))
            SkeletonBlock(Modifier.fillMaxWidth(0.6f).height(16.dp))
        }
    }
}
