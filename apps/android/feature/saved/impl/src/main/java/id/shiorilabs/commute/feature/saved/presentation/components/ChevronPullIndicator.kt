package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.feature.station.presentation.components.PidsChevronsProgress

private val IndicatorShape = RoundedCornerShape(percent = 50)
private val IndicatorElevation = 6.dp

/** Smallest the indicator draws, at the very start of a pull; full size by the threshold. */
private const val MIN_SCALE = 0.7f

/**
 * Home's pull to refresh, drawn as the "›››" the boards put beside a train arriving now: the
 * chevrons light one by one as the pull nears [threshold], all three by the time letting go will
 * refresh, and ripple like an arriving train's while the refresh runs.
 *
 * Moves as Material's own indicator does, emerging from under its anchor line, so it slots into
 * [androidx.compose.material3.pulltorefresh.PullToRefreshBox]'s indicator slot.
 */
@Composable
internal fun ChevronPullIndicator(
    state: PullToRefreshState,
    isRefreshing: Boolean,
    modifier: Modifier = Modifier,
    threshold: Dp = PullToRefreshDefaults.PositionalThreshold,
) {
    Box(
        modifier = modifier
            // Hidden above its anchor line until pulled down past it, as Material's is.
            .drawWithContent {
                clipRect(top = 0f, left = -Float.MAX_VALUE, right = Float.MAX_VALUE, bottom = Float.MAX_VALUE) {
                    this@drawWithContent.drawContent()
                }
            }
            .graphicsLayer {
                val fraction = state.distanceFraction
                val shown = fraction > 0f || isRefreshing
                translationY = fraction * threshold.toPx() - size.height
                val scale = MIN_SCALE + (1f - MIN_SCALE) * fraction.coerceIn(0f, 1f)
                scaleX = scale
                scaleY = scale
                shadowElevation = if (shown) IndicatorElevation.toPx() else 0f
                shape = IndicatorShape
                clip = true
            }
            .background(MaterialTheme.colorScheme.surface, IndicatorShape)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        PidsChevronsProgress(
            progress = { state.distanceFraction },
            pulsing = isRefreshing,
            color = MaterialTheme.colorScheme.primary,
            fontSize = 24.sp,
        )
    }
}
