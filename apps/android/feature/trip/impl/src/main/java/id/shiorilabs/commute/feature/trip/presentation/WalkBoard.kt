package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.ui.components.ExitBadge
import id.shiorilabs.commute.core.ui.components.ExitSignCode
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.ExitYellow
import id.shiorilabs.commute.core.ui.theme.SignageNavy
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.station.presentation.components.LineRoundel
import id.shiorilabs.commute.feature.trip.R
import java.time.Instant

private val WalkHairline = Color(0x33FFFFFF)

/**
 * The board while walking between rides, in place of the in-train display: nobody is on a train, so
 * it reads as signs to follow. Where to, by which exit and corridor when those are on record, how far,
 * then the ride at the end of it.
 */
@Composable
internal fun WalkBoard(
    pids: Pids,
    walk: TripLeg.Transfer,
    lines: Map<String, LineInfo>,
    ink: Color,
    muted: Color,
    onNameMoved: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (pids.signExit != null) {
        Column(modifier = modifier.fillMaxWidth().background(ink)) {
            ExitSign(pids, walk, pids.signExit, onNameMoved)
            Column(modifier = Modifier.padding(start = 20.dp, top = 12.dp, end = 20.dp, bottom = 16.dp)) {
                NextRide(pids.ride, pids.at, lines, muted)
            }
        }
        return
    }
    Column(modifier = modifier.fillMaxWidth().background(ink)) {
        WalkAhead(pids, walk, muted, onNameMoved)
        // Edge to edge, as the ruled line between panels on a sign.
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(WalkHairline))
        Column(modifier = Modifier.padding(start = 20.dp, top = 12.dp, end = 20.dp, bottom = 16.dp)) {
            NextRide(pids.ride, pids.at, lines, muted)
        }
    }
}

/** Where the walk goes, by which exit and corridor when those are on record, and how far. */
@Composable
private fun WalkAhead(pids: Pids, walk: TripLeg.Transfer, muted: Color, onNameMoved: (Float) -> Unit) {
    Column(modifier = Modifier.padding(start = 20.dp, top = 12.dp, end = 20.dp, bottom = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(imageVector = CommuteIcons.Walk, contentDescription = null, modifier = Modifier.size(16.dp), tint = muted)
            Text(
                text = stringResource(pids.label.text),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = muted,
            )
        }
        StationName(
            pids.station,
            modifier = Modifier
                .padding(top = 2.dp)
                .onGloballyPositioned { onNameMoved(it.positionInRoot().y + it.size.height) },
        )
        walk.fromExit?.let { exit ->
            Row(
                modifier = Modifier.padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = stringResource(R.string.trip_walk_by_exit),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
                ExitBadge(code = exit)
            }
        }
        walk.corridorLabel?.let {
            Text(
                text = stringResource(R.string.trip_live_walk_corridor, it),
                modifier = Modifier.padding(top = 6.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
        pids.walkMinutes?.let { minutes ->
            Text(
                text = stringResource(R.string.trip_pids_walk_ahead, walk.distanceM, minutes),
                modifier = Modifier.padding(top = 6.dp),
                style = MaterialTheme.typography.labelLarge,
                color = muted,
            )
        }
    }
}

/**
 * The walk's first minute, as the exit is signed in the station: the code huge in signage navy on
 * exit yellow, and what it leads to under it. The arrow is the sign's look, not a direction: it
 * always points right, as nothing here knows the way to the exit.
 */
@Composable
private fun ExitSign(pids: Pids, walk: TripLeg.Transfer, exit: String, onNameMoved: (Float) -> Unit) {
    val body = MaterialTheme.typography.titleMedium
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(ExitYellow)
            .padding(start = 20.dp, top = 12.dp, end = 20.dp, bottom = 16.dp),
    ) {
        Text(
            text = stringResource(R.string.trip_walk_exit_sign),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = SignageNavy,
        )
        Row(modifier = Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            ExitSignCode(code = exit, modifier = Modifier.weight(1f, fill = false))
            Icon(
                imageVector = CommuteIcons.ArrowRight,
                contentDescription = null,
                modifier = Modifier.padding(start = 16.dp).size(64.dp),
                tint = SignageNavy,
            )
        }
        Text(
            text = stringResource(pids.label.text) + " " + pids.station,
            modifier = Modifier
                .padding(top = 8.dp)
                .onGloballyPositioned { onNameMoved(it.positionInRoot().y + it.size.height) },
            style = body,
            fontWeight = FontWeight.Bold,
            color = SignageNavy,
        )
        walk.corridorLabel?.let {
            Text(
                text = stringResource(R.string.trip_live_walk_corridor, it),
                modifier = Modifier.padding(top = 2.dp),
                style = body,
                fontWeight = FontWeight.Bold,
                color = SignageNavy,
            )
        }
        pids.walkMinutes?.let { minutes ->
            Text(
                text = stringResource(R.string.trip_pids_walk_ahead, walk.distanceM, minutes),
                modifier = Modifier.padding(top = 6.dp),
                style = MaterialTheme.typography.labelLarge,
                color = SignageNavy,
            )
        }
        if (walk.fromExitSigns.isNotEmpty()) {
            Text(
                text = boardText(walk),
                modifier = Modifier.padding(top = 10.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = SignageNavy,
            )
        }
    }
}

/** What the exit's board prints, so the phone reads like the sign overhead: the line for where the walk goes in bold. */
private fun boardText(walk: TripLeg.Transfer) = buildAnnotatedString {
    walk.fromExitSigns.forEachIndexed { index, sign ->
        if (index > 0) append(" · ")
        if (sign.stationId == walk.to.id) {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(sign.text) }
        } else {
            append(sign.text)
        }
    }
}

/** The ride at the end of the walk: its line, or every line that will do, where to stand for it and when it should leave. */
@Composable
private fun NextRide(ride: TripLeg.Ride, at: Instant?, lines: Map<String, LineInfo>, muted: Color) {
    val platform = ride.platformCode?.let { stringResource(CopyR.string.trip_platform, formatPlatformCode(it)) }
    val facts = listOfNotNull(platform, at?.let(::formatClock)).joinToString(" · ").takeIf { it.isNotEmpty() }
    if (ride.otherLines > 0) {
        AnyLine(ride, lines, color = muted)
        facts?.let { Text(text = it, modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.labelLarge, color = muted) }
    } else {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(text = stringResource(R.string.trip_walk_then_board), style = MaterialTheme.typography.labelLarge, color = muted)
            LineRoundel(ride.line, lines[ride.line], operator = ride.operator, size = RoundelSize.SM)
            facts?.let { Text(text = it, style = MaterialTheme.typography.labelLarge, color = muted) }
        }
    }
    rideDirection(ride)?.let {
        Text(text = it, modifier = Modifier.padding(top = 4.dp), style = MaterialTheme.typography.labelLarge, color = muted)
    }
}

@Preview(showBackground = true)
@Composable
private fun WalkBoardPreview() {
    val context = LocalContext.current
    val now = Instant.now()
    val trip = TripPreviewData.walking(now)
    val pids = trip.pids(now)
    val copy = TripCopy(context.resources, TripPreviewData.lines)
    CommutePreviewScaffold {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            listOf(PidsStyle.BekasiRailway(), PidsStyle.Yishun).forEach { style ->
                PidsBoard(
                    style = style,
                    pids = pids,
                    lines = TripPreviewData.lines,
                    stationLines = TripPreviewData.stationLines[pids.stationId].orEmpty(),
                    copy = copy,
                    source = null,
                    onNameMoved = {},
                )
            }
        }
    }
}
