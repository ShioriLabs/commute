package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.presentation.components.LineCard
import java.time.LocalDateTime

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
 *
 * [onClick] opens the station's page; the whole row is the target, not just the name's width.
 */
@Composable
fun StationTitle(
    name: String,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
    onClick: (() -> Unit)? = null,
) {
    Text(
        text = stringResource(R.string.saved_station_title, name),
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // Under the inset, so a tap behind the clock doesn't open anything.
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
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
            retryLabel = stringResource(R.string.saved_retry),
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
    card: StationBoard,
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
            retryLabel = stringResource(R.string.saved_retry),
            onRetry = onRetry,
            modifier = inset,
        )

        is UIState.Success -> if (timetable.data.isEmpty()) {
            ProblemPanel(
                message = stringResource(R.string.saved_timetable_empty),
                retryLabel = stringResource(R.string.saved_retry),
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
