package id.shiorilabs.commute.feature.trip.presentation

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.zIndex
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.presentation.components.PidsChevrons
import id.shiorilabs.commute.feature.trip.R
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.roundToInt

/** Near-black, like the band over a JR East display, and home's running-trip card. */
private val BoardInk = Color(0xFF0F172A)
private val BoardMuted = Color(0xFF94A3B8)
private val BoardDim = Color(0xFF64748B)
private val PlainText = Color(0xFF0F172A)

/** The next stop's bubble, the display's yellow. */
private val NextStop = Color(0xFFFBBF24)

private val StripHeight = 340.dp
/** The band's width nearest the rider; it narrows with distance, and the bubbles with it. */
private val BandWidth = 48.dp

/** Keeps a white bubble apart from a pale line (a yellow corridor) and the page around it. */
private val BubbleRing = Color(0x1F0F172A)

/**
 * The in-train display: a dark band naming the next station, over the line's own colour carrying
 * the stops ahead, nearest at the bottom. Adapted from JR East's for a phone held upright, so the
 * band rises up the left and the names read to its right.
 */
@Composable
internal fun PidsBoard(
    pids: Pids,
    lines: Map<String, LineInfo>,
    /** The lines at [Pids.stationId], keyed `OPERATOR:CODE`, for "bisa pindah ke". */
    stationLines: List<String>,
    copy: TripCopy,
    source: String?,
    topInset: Dp,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    DarkStatusBarIcons()
    val line = lines[pids.ride.line]
    val color = parseHexColor(line?.colorCode ?: "", BoardMuted)
    Column(modifier = modifier.fillMaxWidth()) {
        // Over the strip: its band runs on up behind the plate.
        Header(pids, copy, color, topInset, onClose, modifier = Modifier.zIndex(1f))
        if (pids.upcoming.isNotEmpty()) Strip(pids, color, source)
        ChangePanel(pids, lines, stationLines, copy)
    }
}

/** Light icons over the dark band while the board shows; the app's dark ones again after. */
@Composable
private fun DarkStatusBarIcons() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = view.context.findActivity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.isAppearanceLightStatusBars = false
        onDispose { controller?.isAppearanceLightStatusBars = true }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun Header(pids: Pids, copy: TripCopy, color: Color, topInset: Dp, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(BoardInk)
            .padding(top = topInset)
            .padding(start = 24.dp, top = 12.dp, end = 12.dp, bottom = 20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = copy.rideName(pids.ride),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = BoardMuted,
            )
            pids.at?.let {
                Text(
                    text = formatClock(it),
                    modifier = Modifier.padding(end = 8.dp),
                    style = MaterialTheme.typography.titleMedium,
                    color = BoardMuted,
                )
            }
            CommuteIconButton(onClick = onClose, modifier = Modifier.size(40.dp)) {
                Icon(
                    imageVector = CommuteIcons.Close,
                    contentDescription = stringResource(R.string.trip_live_close),
                    modifier = Modifier.size(24.dp),
                    tint = Color.White,
                )
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp)
                .height(IntrinsicSize.Min),
            verticalAlignment = Alignment.Bottom,
        ) {
            pids.ride.headsign?.let { headsign ->
                Column(modifier = Modifier.width(88.dp), horizontalAlignment = Alignment.End) {
                    Text(
                        text = stringResource(R.string.trip_pids_towards),
                        style = MaterialTheme.typography.labelMedium,
                        color = BoardMuted,
                    )
                    Text(
                        text = headsign,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Box(
                    modifier = Modifier
                        .padding(horizontal = 12.dp)
                        .width(8.dp)
                        .fillMaxHeight()
                        .background(color),
                )
            }
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(pids.label.text),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = BoardMuted,
                    )
                    if (pids.label == PidsLabel.ALIGHT_HERE || pids.label == PidsLabel.ALIGHT_NEXT) {
                        PidsChevrons(color = NextStop)
                    }
                }
                BasicText(
                    text = pids.station,
                    modifier = Modifier.semantics { heading() },
                    style = TextStyle(color = Color.White, fontWeight = FontWeight.Bold, lineHeight = 52.sp),
                    maxLines = 1,
                    autoSize = TextAutoSize.StepBased(minFontSize = 24.sp, maxFontSize = 48.sp, stepSize = 2.sp),
                )
            }
        }
    }
}

private val PidsLabel.text: Int
    get() = when (this) {
        PidsLabel.BOARD -> R.string.trip_pids_board
        PidsLabel.NEXT -> R.string.trip_pids_next
        PidsLabel.ALIGHT_NEXT -> R.string.trip_pids_alight_next
        PidsLabel.ALIGHT_HERE -> R.string.trip_pids_alight_here
        PidsLabel.ARRIVED -> R.string.trip_pids_arrived
    }

/**
 * The band and its stops: a stretch of a loop seen from above and a little behind, as JR East draws
 * the Yamanote line. The band is an arc of a circle centred off to the right, rising up the left
 * and sweeping away under the plate, narrowing with distance, and the stops bunch up as they recede,
 * the nearest at the bottom with the rider's marker below it.
 */
@Composable
private fun Strip(pids: Pids, color: Color, source: String?) {
    val density = LocalDensity.current
    val description = stringResource(R.string.trip_pids_description, pids.upcoming.joinToString { it.name })
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(StripHeight)
            .clearAndSetSemantics { contentDescription = description },
    ) {
        val arc = Arc(
            width = with(density) { maxWidth.toPx() },
            height = with(density) { maxHeight.toPx() },
            nearBand = with(density) { BandWidth.toPx() },
        )
        val count = pids.upcoming.size
        val angles = stopAngles(count)
        val marker = arc.point(MARKER_ANGLE)

        Canvas(
            modifier = Modifier
                .matchParentSize()
                // Below the strip is the page; above it the plate, which draws over the band.
                .drawWithContent {
                    clipRect(top = -size.height * 4, bottom = size.height) { this@drawWithContent.drawContent() }
                },
        ) {
            drawPath(arc.band(), color)
            // The rider: a chevron on the band pointing the way it goes.
            val tangent = arc.tangent(MARKER_ANGLE)
            val angle = Math.toDegrees(atan2(tangent.y, tangent.x).toDouble()).toFloat()
            rotate(angle + 90f, pivot = marker) {
                val s = arc.widthAt(MARKER_ANGLE) * 0.42f
                val chevron = Path().apply {
                    moveTo(marker.x - s, marker.y + s * 0.6f)
                    lineTo(marker.x, marker.y - s * 0.6f)
                    lineTo(marker.x + s, marker.y + s * 0.6f)
                }
                drawPath(chevron, BoardInk, style = Stroke(width = s * 0.7f, cap = StrokeCap.Round))
            }
        }

        pids.upcoming.forEachIndexed { i, stop ->
            val angle = angles[i]
            val point = arc.point(angle)
            val band = arc.widthAt(angle)
            // Bubbles sit inside the band and shrink with it; the next stop's stands proud of it.
            val bubblePx = if (stop.next) band * 1.0f else band * 0.8f
            val bubble = with(density) { bubblePx.toDp() }
            StopBubble(
                stop = stop,
                size = bubble,
                modifier = Modifier.offset { IntOffset((point.x - bubblePx / 2).roundToInt(), (point.y - bubblePx / 2).roundToInt()) },
            )
            StopName(
                stop = stop,
                // Nearest biggest, receding with the band.
                size = (30 - i * 3).coerceAtLeast(17),
                at = point,
                clearance = band / 2,
            )
        }

        source?.let {
            Text(
                text = it,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 24.dp, bottom = 12.dp),
                style = MaterialTheme.typography.labelSmall,
                color = BoardDim,
            )
        }
    }
}

/** Where the rider's chevron sits, just inside the strip's bottom edge. */
private const val MARKER_ANGLE = 0.07f

/** The nearest stop's angle, and the gap to the next; each further gap shrinks by [RECEDE]. */
private const val FIRST_STOP_ANGLE = 0.19f
private const val FIRST_GAP = 0.165f
private const val RECEDE = 0.88f

/** The stops' angles along the arc, nearest first: closer together as they recede. */
private fun stopAngles(count: Int): List<Float> {
    var angle = FIRST_STOP_ANGLE
    var gap = FIRST_GAP
    return List(count) {
        val at = angle
        angle += gap
        gap *= RECEDE
        at
    }
}

/**
 * The loop the band is part of: a circle centred off the strip's bottom right, so its left side
 * rises out of the bottom edge almost upright and curves away to the right as it climbs. An angle
 * of 0 is the bottom edge; the band runs on past the strip's top to [FAR_ANGLE], under the plate.
 */
private class Arc(width: Float, private val height: Float, private val nearBand: Float) {

    private val cx = width * 1.18f
    private val radius = width * 1.07f

    fun point(angle: Float) = Offset(cx - radius * cos(angle), height - radius * sin(angle))

    /** The way the band runs at [angle], up and to the right. */
    fun tangent(angle: Float) = Offset(radius * sin(angle), -radius * cos(angle))

    /** Narrower with distance: two fifths of its near width by the time it reaches the plate. */
    fun widthAt(angle: Float) = nearBand * (1f - 0.6f * (angle / FAR_ANGLE).coerceIn(0f, 1f))

    /** The band as one filled shape, its edges following the circle in and out by half its width. */
    fun band(): Path = Path().apply {
        val steps = 64
        val angles = (0..steps).map { NEAR_ANGLE + (FAR_ANGLE - NEAR_ANGLE) * it / steps }
        angles.forEachIndexed { i, a ->
            val r = radius + widthAt(a) / 2
            val x = cx - r * cos(a)
            val y = height - r * sin(a)
            if (i == 0) moveTo(x, y) else lineTo(x, y)
        }
        angles.asReversed().forEach { a ->
            val r = radius - widthAt(a) / 2
            lineTo(cx - r * cos(a), height - r * sin(a))
        }
        close()
    }

    private companion object {
        const val NEAR_ANGLE = -0.12f
        const val FAR_ANGLE = 1.3f
    }
}

@Composable
private fun StopBubble(stop: PidsStop, size: Dp, modifier: Modifier) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(if (stop.next) NextStop else Color.White)
            .border(if (stop.next) 3.dp else 1.5.dp, if (stop.next) Color.White else BubbleRing, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        stop.minutes?.let {
            Text(
                text = it.toString(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = PlainText,
            )
        }
    }
}

@Composable
private fun StopName(stop: PidsStop, size: Int, at: Offset, clearance: Float) {
    val density = LocalDensity.current
    // Clear of the band's outer edge.
    val gap = with(density) { 12.dp.toPx() }
    Column(
        modifier = Modifier.offset {
            IntOffset((at.x + clearance + gap).roundToInt(), (at.y - with(density) { (size * 0.75f).sp.toPx() }).roundToInt())
        },
    ) {
        Text(
            text = stop.name,
            fontSize = size.sp,
            lineHeight = (size * 1.15f).sp,
            fontWeight = if (stop.next || stop.alighting) FontWeight.Bold else FontWeight.SemiBold,
            color = PlainText,
            maxLines = 1,
        )
        if (stop.alighting) {
            Text(
                text = stringResource(R.string.trip_pids_get_off),
                modifier = Modifier
                    .padding(top = 2.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(horizontal = 6.dp, vertical = 1.dp),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
}

/**
 * The display's "乗換えのご案内": at the station the board names, the ride the plan changes onto
 * there, or else the other lines a rider could change to.
 */
@Composable
private fun ChangePanel(pids: Pids, lines: Map<String, LineInfo>, stationLines: List<String>, copy: TripCopy) {
    val change = pids.changeTo
    val others = stationLines.filter { it != pids.ride.line }
    if (change == null && others.isEmpty()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(PaddingValues(start = 32.dp, end = 32.dp, top = 8.dp)),
    ) {
        Text(
            text = stringResource(R.string.trip_pids_change_at, pids.station),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = BoardDim,
        )
        if (change != null) {
            Row(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Roundel(change, lines)
                Text(
                    text = listOfNotNull(
                        stringResource(R.string.trip_change, copy.rideName(change)),
                        change.platformCode?.let { stringResource(R.string.trip_platform, it) },
                    ).joinToString(copy.separator),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = PlainText,
                )
            }
        } else {
            FlowRow(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                others.forEach { key ->
                    val info = lines[key]
                    LineRoundel(
                        code = info?.lineCode ?: key.substringAfter(':'),
                        color = info?.colorCode ?: "#94A3B8",
                        operator = key.substringBefore(':'),
                        size = RoundelSize.SM,
                    )
                }
            }
        }
    }
}

@Composable
private fun Roundel(ride: TripLeg.Ride, lines: Map<String, LineInfo>) {
    val info = lines[ride.line]
    LineRoundel(
        code = info?.lineCode ?: ride.line.substringAfter(':'),
        color = info?.colorCode ?: "#94A3B8",
        operator = ride.operator,
        size = RoundelSize.SM,
    )
}
