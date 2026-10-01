package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.saved.presentation.StationCardState
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.presentation.components.LineCard
import java.time.LocalDateTime

/** Placeholder blocks, the web's `bg-slate-200`. */
private val SkeletonColor = Color(0xFFE2E8F0)

/** The failure panel, the web's `bg-rose-50` with `text-slate-700`. */
private val ProblemFill = Color(0xFFFFF1F2)
private val ProblemInk = Color(0xFF334155)

/**
 * At most this many line placeholders while a board loads. An interchange like Manggarai serves
 * enough lines that one each would fill several screens, and a skeleton taller than what replaces it
 * shoves the page the other way when it resolves.
 */
private const val MAX_SKELETON_LINES = 3

/**
 * A saved station's name, the header over its line cards. On the feed it is a sticky header, so
 * [modifier] carries the backdrop blur that lets the cards scrolling under it show through.
 *
 * [topInset] is the status bar's height, carried inside the header rather than above the list: a
 * stuck title then reaches up behind the clock with no change of size at the moment it sticks.
 */
@Composable
fun StationTitle(
    name: String,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
) {
    Text(
        text = stringResource(R.string.saved_station_title, name),
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            .padding(16.dp)
            .semantics { heading() },
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/**
 * A saved station that hasn't loaded: its skeleton while it loads, or a compact retry card when it
 * failed. Not the feed's empty state, which is the wrong message here: this IS a saved station.
 */
@Composable
fun StationPlaceholder(
    station: UIState<*>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (station is UIState.Error) {
        val offline = station.cause?.toFailure() is Failure.Network
        ProblemPanel(
            message = stringResource(if (offline) R.string.saved_station_offline else R.string.saved_station_failed),
            onRetry = onRetry,
            modifier = modifier.padding(horizontal = 16.dp).padding(top = 16.dp),
        )
    } else {
        StationSkeleton(modifier)
    }
}

/**
 * A loaded station's departures: a [LineCard] per line that still has departures. The board fails
 * on its own, saying so under the station's name, as does a board that comes back empty.
 */
@Composable
fun StationTimetable(
    card: StationCardState,
    lineCount: Int,
    lines: Map<String, LineInfo>,
    now: LocalDateTime,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val inset = modifier.padding(horizontal = 16.dp)
    when (val timetable = card.timetable) {
        // One placeholder per line the station serves, so the skeleton is roughly the shape of what
        // replaces it. The station resolves first and carries its lines, which is what makes that
        // possible.
        is UIState.Idle, is UIState.Loading -> Column(
            modifier = inset,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            repeat(lineCount.coerceIn(1, MAX_SKELETON_LINES)) {
                SkeletonBlock(Modifier.fillMaxWidth().height(280.dp))
            }
        }

        is UIState.Error -> ProblemPanel(
            message = stringResource(R.string.saved_timetable_failed),
            onRetry = onRetry,
            modifier = inset,
        )

        is UIState.Success -> if (timetable.data.isEmpty()) {
            ProblemPanel(
                message = stringResource(R.string.saved_timetable_empty),
                onRetry = onRetry,
                modifier = inset,
            )
        } else {
            Column(
                modifier = inset,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                timetable.data.forEach { line: LineTimetable ->
                    LineCard(
                        line = line,
                        lineInfo = lines[line.lineKey],
                        now = now,
                        nextDayLine = card.nextDayLine(line),
                    )
                }
            }
        }
    }
}

@Composable
private fun StationSkeleton(modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(horizontal = 16.dp)) {
        SkeletonBlock(
            Modifier
                .padding(start = 16.dp, top = 16.dp)
                .width(256.dp)
                .height(24.dp),
        )
        SkeletonBlock(
            Modifier
                .padding(top = 16.dp)
                .fillMaxWidth()
                .height(320.dp),
        )
    }
}

/** A placeholder block pulsing like the web's `animate-pulse`. */
@Composable
private fun SkeletonBlock(modifier: Modifier = Modifier) {
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
            .background(SkeletonColor, MaterialTheme.shapes.medium),
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

@Composable
private fun ProblemPanel(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(ProblemFill, MaterialTheme.shapes.medium)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = ProblemInk,
        )
        Button(
            onClick = onRetry,
            shape = MaterialTheme.shapes.small,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            Text(
                text = stringResource(R.string.saved_retry),
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
