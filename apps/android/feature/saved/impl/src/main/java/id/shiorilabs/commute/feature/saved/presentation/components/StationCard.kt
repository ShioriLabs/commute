package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.isOffline
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.domain.isTransJakarta
import id.shiorilabs.commute.feature.station.presentation.components.HalteFrequencies
import id.shiorilabs.commute.feature.station.presentation.components.LineCard
import id.shiorilabs.commute.feature.station.presentation.sharedLineCard
import id.shiorilabs.commute.feature.station.presentation.StationTitleText
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
 * [onClick] opens the station's page; the whole row is the target, not just the title's width. The
 * title flies into the page's header as a shared element, with [shareName] off for a copy hidden
 * behind the one doing it. [opened] is no longer used: with no "Stasiun" before the name there is
 * no word to clip in and out as the page opens; kept so callers need not change.
 *
 * [note] sits muted at the row's far end, on the title's baseline: how far a nearby station is.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun StationTitle(
    stationId: String,
    name: String,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
    shareName: Boolean = true,
    opened: Boolean = false,
    note: String? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val haptics = LocalHapticFeedback.current
    val longClickLabel = stringResource(R.string.saved_title_edit_action)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // Under the inset, so a tap behind the clock doesn't open anything.
            .then(
                if (onClick != null) {
                    Modifier.combinedClickable(
                        role = Role.Button,
                        onLongClickLabel = longClickLabel.takeIf { onLongClick != null },
                        onLongClick = onLongClick?.let { hold ->
                            {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                hold()
                            }
                        },
                        onClick = onClick,
                    )
                } else {
                    Modifier
                },
            )
            .padding(16.dp)
            .semantics(mergeDescendants = true) { heading() },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Wrapped, so the title keeps its own width for the flight while the note is pushed to the end.
        Box(modifier = Modifier.weight(1f).alignByBaseline()) {
            StationTitleText(
                stationId = stationId,
                name = name,
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                ),
                shared = shareName,
                // The web's caret after the name: this opens the station's page.
                trailingIcon = if (onClick != null) CommuteIcons.Chevron else null,
            )
        }
        if (note != null) {
            Text(
                text = note,
                modifier = Modifier.alignByBaseline(),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = Slate500,
                maxLines = 1,
            )
        }
    }
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
        val offline = station.isOffline()
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
 * on its own, saying so under the station's name, as does a board that comes back empty. A halte's
 * board is always empty, TransJakarta publishing no timetable, so it shows its frequencies instead.
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

        is UIState.Success -> if (timetable.data.isEmpty() && isTransJakarta(card.stationId)) {
            when (val frequencies = card.frequencies) {
                is UIState.Idle, is UIState.Loading -> SkeletonBlock(inset.fillMaxWidth().height(280.dp))
                is UIState.Success, is UIState.Error -> HalteFrequencies(
                    frequencies = (frequencies as? UIState.Success)?.data,
                    lines = lines,
                    modifier = inset,
                )
            }
        } else if (timetable.data.isEmpty()) {
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
                        modifier = Modifier.sharedLineCard(card.stationId, line.lineKey),
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

@Preview(showBackground = true)
@Composable
private fun StationTitlePreview() {
    CommutePreviewScaffold {
        Column {
            StationTitle(stationId = "KCI-MRI", name = "Manggarai", onClick = {})
            StationTitle(stationId = "KCI-SUD", name = "Sudirman", note = "350 m", onClick = {})
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun StationPlaceholderPreview() {
    CommutePreviewScaffold {
        Column {
            StationPlaceholder(station = UIState.Loading, onRetry = {})
            StationPlaceholder(station = UIState.Error("gagal"), onRetry = {})
        }
    }
}

@Preview(showBackground = true, heightDp = 600)
@Composable
private fun StationTimetablePreview() {
    val lineKey = "KCI:B"
    val board = StationBoard(
        stationId = "KCI-MRI",
        station = UIState.Success(Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf(lineKey))),
        timetable = UIState.Success(
            listOf(
                LineTimetable(
                    lineKey = lineKey,
                    groups = listOf(
                        DirectionGroup(
                            key = "south",
                            label = listOf("Bogor"),
                            platformCode = "3/4",
                            destinations = listOf(
                                DestinationTimetable("Bogor", null, List(10) { Departure(null, 8 * 60 + 2 + it * 12) }),
                            ),
                        ),
                    ),
                ),
            ),
        ),
        nextDayBoard = null,
        nextDayDiffers = false,
    )
    CommutePreviewScaffold {
        StationTimetable(
            card = board,
            lineCount = 1,
            lines = mapOf(lineKey to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")),
            now = LocalDateTime.of(2026, 10, 1, 8, 0),
            onRetry = {},
        )
    }
}
