package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.NavigationArrow
import id.shiorilabs.commute.core.ui.ext.Foreground
import id.shiorilabs.commute.core.ui.ext.foreground
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.api.R
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DepartureLabel
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.UpcomingDestination
import id.shiorilabs.commute.feature.station.domain.UpcomingGroup
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import id.shiorilabs.commute.feature.station.domain.departureLabel
import id.shiorilabs.commute.feature.station.domain.formatClock
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.station.domain.isImminentDeparture
import id.shiorilabs.commute.feature.station.domain.joinLabels
import id.shiorilabs.commute.feature.station.domain.upcomingGroups
import java.time.LocalDateTime

/** While the line dictionary is still loading: the card renders grey rather than blanking. */
private val FallbackLineColor = Color(0xFF94A3B8)

// Tailwind's greys, as the web card uses them.
private val Slate800 = Color(0xFF1E293B)
private val Slate700 = Color(0xFF334155)
private val Slate500 = Color(0xFF64748B)
private val Gray600 = Color(0xFF4B5563)
private val Gray500 = Color(0xFF6B7280)

/** Departure times line up in columns: tabular figures. */
private const val TABULAR = "tnum"

/**
 * One line's departures from a station, as the home feed and the station page show them: the line's
 * colour as a thick top edge over a pale wash of it, then one section per direction, then a row per
 * terminus with the next departure large and the two after it small.
 *
 * Built afresh from [now], so the caller re-renders it as the clock moves. Renders nothing when the
 * line has nothing left to show.
 *
 * @param lineInfo the line's name and colour; null while the dictionary loads.
 * @param nextDayLine the same line on the next service day's board, for "mulai lagi" once a
 *   terminus has finished for the night.
 * @param onHeaderClick opens the line's page from the card's name, which then trails a chevron, as
 *   on the web's station page; null leaves the name plain, as on the home feed.
 */
@Composable
fun LineCard(
    line: LineTimetable,
    lineInfo: LineInfo?,
    now: LocalDateTime,
    modifier: Modifier = Modifier,
    nextDayLine: LineTimetable? = null,
    onHeaderClick: (() -> Unit)? = null,
) {
    val groups = remember(line, nextDayLine, now) { upcomingGroups(line, nextDayLine, now) }
    if (groups.isEmpty()) {
        return
    }

    val lineName = lineInfo?.name
        ?: codeOfLineKey(line.lineKey).ifEmpty { stringResource(R.string.line_card_fallback_name) }
    val lineColor = lineInfo?.let { parseHexColor(it.colorCode) } ?: FallbackLineColor
    val divider = lineColor.tint(0.3f)
    val shape = MaterialTheme.shapes.medium
    val cardDescription = stringResource(R.string.line_card_description, lineName)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(8.dp, shape)
            .clip(shape)
            .background(lineColor.tint(0.065f))
            .semantics { contentDescription = cardDescription },
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(16.dp)
                .background(lineColor),
        )
        LineCardHeader(lineName, onHeaderClick)
        HorizontalDivider(thickness = 2.dp, color = divider)
        groups.forEachIndexed { index, group ->
            if (index > 0) {
                HorizontalDivider(thickness = 1.dp, color = divider)
            }
            if (group.showHeader) {
                GroupHeader(group, lineColor)
            }
            group.destinations.forEach { destination ->
                DestinationRow(destination, lineColor, now)
            }
        }
    }
}

/** The line's name over the card, and with [onClick] a link to its page, chevron and all. */
@Composable
private fun LineCardHeader(lineName: String, onClick: (() -> Unit)?) {
    val description = stringResource(R.string.line_card_open_line_description, lineName)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier
                        .clickable(role = Role.Button, onClick = onClick)
                        .semantics(mergeDescendants = true) { contentDescription = description }
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = lineName,
            modifier = Modifier.weight(1f, fill = false),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (onClick != null) {
            Icon(
                imageVector = CommuteIcons.Chevron,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
}

@Composable
private fun GroupHeader(group: UpcomingGroup, lineColor: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(lineColor.tint(0.16f))
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!group.labelIsRedundant) {
            Icon(
                imageVector = PhosphorIcons.Fill.NavigationArrow,
                contentDescription = null,
                modifier = Modifier
                    .size(12.dp)
                    .rotate(90f),
                tint = lineColor,
            )
        }
        Text(
            text = if (group.labelIsRedundant) "" else joinLabels(group.label).uppercase(),
            modifier = Modifier.weight(1f),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.3.sp,
            color = Slate700,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        group.platformCode?.let { platform ->
            val formatted = formatPlatformCode(platform)
            val badgeDescription = stringResource(R.string.line_card_platform_description, formatted)
            Text(
                text = stringResource(R.string.line_card_platform, formatted),
                modifier = Modifier
                    .clip(CircleShape)
                    .background(lineColor)
                    .padding(horizontal = 8.dp, vertical = 2.dp)
                    .clearAndSetSemantics { contentDescription = badgeDescription },
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = if (lineColor.foreground() == Foreground.LIGHT) Color.White else Color(0xFF0F172A),
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun DestinationRow(destination: UpcomingDestination, lineColor: Color, now: LocalDateTime) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = destination.boundFor,
                style = MaterialTheme.typography.bodyMedium,
                color = Slate800,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            destination.via?.let { via ->
                Text(
                    text = stringResource(R.string.line_card_via, via),
                    fontSize = 12.sp,
                    color = Gray500,
                )
            }
        }
        if (destination.over) {
            OverTimes(destination)
        } else {
            NextTimes(destination.departures, lineColor, now)
        }
    }
}

@Composable
private fun NextTimes(departures: List<Departure>, lineColor: Color, now: LocalDateTime) {
    val lead = departures.first()
    val label = departureLabel(now, lead.minute)
    val text = when (label) {
        is DepartureLabel.Now -> stringResource(R.string.line_card_now)
        is DepartureLabel.InMinutes -> stringResource(R.string.line_card_in_minutes, label.minutes)
        is DepartureLabel.At -> formatClock(label.minute)
    }
    val description = when (label) {
        is DepartureLabel.Now -> stringResource(R.string.line_card_now_description)
        is DepartureLabel.InMinutes -> stringResource(R.string.line_card_in_minutes_description, label.minutes)
        is DepartureLabel.At -> stringResource(R.string.line_card_at_description, formatClock(label.minute))
    }

    Column(horizontalAlignment = Alignment.End) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isImminentDeparture(now, lead.minute)) {
                PidsChevrons(color = lineColor)
            }
            Text(
                text = text,
                modifier = Modifier.semantics { contentDescription = description },
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontSize = 24.sp,
                    lineHeight = 30.sp,
                    fontFeatureSettings = TABULAR,
                ),
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        if (departures.size > 1) {
            val later = departures.drop(1).take(2).joinToString(", ") { formatClock(it.minute) }
            val laterDescription = stringResource(R.string.line_card_then_description, later)
            Text(
                text = stringResource(R.string.line_card_then, later),
                // Read out as the web's label has it, rather than the terse "lalu …" on screen.
                modifier = Modifier.semantics { contentDescription = laterDescription },
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TABULAR),
                color = Gray600,
            )
        }
    }
}

/** Past the last departure: "mulai lagi" when the board knows the restart, else when it ended. */
@Composable
private fun OverTimes(destination: UpcomingDestination) {
    val note = destination.restart
        ?.let { stringResource(R.string.line_card_restarts, formatClock(it.minute)) }
        ?: stringResource(R.string.line_card_last, formatClock(destination.departures.first().minute))
    val description = stringResource(R.string.line_card_over_description, destination.boundFor, note)

    Column(
        modifier = Modifier.clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.End,
    ) {
        Text(
            text = stringResource(R.string.line_card_over),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
            color = Slate500,
        )
        Text(
            text = note,
            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = TABULAR),
            color = Gray600,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LineCardPreview() {
    val now = LocalDateTime.of(2026, 10, 1, 8, 0)
    CommutePreviewScaffold {
        LineCard(
            line = LineTimetable(
                lineKey = "KCI:B",
                groups = listOf(
                    DirectionGroup(
                        key = "south",
                        label = listOf("Bogor", "Nambo"),
                        platformCode = "3/4",
                        destinations = listOf(
                            DestinationTimetable("Bogor", null, List(10) { Departure(null, 8 * 60 + 2 + it * 12) }),
                            DestinationTimetable("Nambo", null, List(4) { Departure(null, 8 * 60 + 25 + it * 60) }),
                        ),
                    ),
                ),
            ),
            lineInfo = LineInfo("Lin Bogor", "B", "#EE3D43", "KCI"),
            now = now,
            modifier = Modifier.padding(16.dp),
        )
    }
}
