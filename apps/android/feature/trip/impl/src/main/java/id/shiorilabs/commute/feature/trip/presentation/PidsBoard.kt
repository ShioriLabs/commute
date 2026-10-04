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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.zIndex
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
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
import kotlin.math.acos
import kotlin.math.asin
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

/** The band's width on the ground. */
private val BandWidth = 40.dp

/** The loop's radius as a multiple of the strip's width: big enough to stay steep where the stops are. */
private const val LOOP_RADIUS = 1.8f

/** The loop's near side this far off the left edge: the band comes in from out of bounds, never up out of the bottom. */
private val LoopOffscreen = 40.dp

/** The nearest stop's bubble and the rider's marker, this far in from the left edge. */
private val NearestStopIn = 58.dp
private val MarkerIn = 22.dp

/** The stops' even vertical rhythm, and the farthest one's distance below the plate. */
private val StopPitch = 42.dp
private val FarthestStopTop = 40.dp

/** Below the band's lower edge where it comes in off the left edge: the strip ends here. */
private val EntryMargin = 12.dp

/** How far the slab's side face shows below its top. */
private val SlabDepth = 7.dp

private val LabelGap = 6.dp
private val NameSize = 20.sp
private val NextNameSize = 26.sp

/** Plus Jakarta Sans' capitals, as a share of its size: what a name is centred on. */
private const val CAP_HEIGHT = 0.7f

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
                    style = MaterialTheme.typography.headlineLarge.merge(color = Color.White, fontWeight = FontWeight.Bold, lineHeight = 52.sp),
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
 * The band and its stops: a stretch of a loop lying on the ground, seen from 45° above, as JR East
 * draws the Yamanote line. The band comes in from off the left edge and sweeps away to the right under
 * the plate, both its ends out of view. Orthographic, so nothing shrinks with
 * distance; the band thins where it turns across the view, and a darker side face shows it as a
 * slab on the ground. The nearest stop is at the bottom, the rider's marker below it.
 */
@Composable
private fun Strip(pids: Pids, color: Color, source: String?) {
    val density = LocalDensity.current
    val description = stringResource(R.string.trip_pids_description, pids.upcoming.joinToString { it.name })
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val width = with(density) { maxWidth.toPx() }
        val loop = with(density) {
            GroundLoop(
                width = width,
                band = BandWidth.toPx(),
                offscreen = LoopOffscreen.toPx(),
                nearestIn = NearestStopIn.toPx(),
                markerIn = MarkerIn.toPx(),
                pitch = StopPitch.toPx(),
                farthestTop = FarthestStopTop.toPx(),
                entryMargin = EntryMargin.toPx(),
            )
        }
        val slab = with(density) { SlabDepth.toPx() }
        val marker = loop.point(loop.markerAngle)
        val side = lerp(color, Color.Black, 0.3f)

        // Each stop's bubble on the band, nearest first.
        val bubbles = pids.upcoming.mapIndexed { i, stop ->
            // The next stop's bubble stands proud of the band; the rest sit inside it.
            loop.stop(i) to (if (stop.next) loop.band * 0.95f else loop.band * 0.7f)
        }
        // Each name beside its bubble, centred on it, starting where the band (its slab included)
        // has climbed clear of the name's top: on the slant that's a little right of the bubble.
        val gap = with(density) { LabelGap.toPx() }
        val starts = pids.upcoming.mapIndexed { i, stop ->
            val (at, size) = bubbles[i]
            // Half the capitals' height at the name's largest: its ink, not its line box. The tag
            // under the stop to get off at hangs below, where the band never is.
            val half = with(density) { (if (stop.next) NextNameSize else NameSize).toPx() } * CAP_HEIGHT / 2
            maxOf(at.x + size / 2, loop.innerEdgeClearOf(at.y - half - slab)) + gap
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(with(density) { loop.height.toDp() })
                .clearAndSetSemantics { contentDescription = description },
        ) {
            Canvas(
                modifier = Modifier
                    .matchParentSize()
                    // Below the strip is the page; above it the plate, which draws over the band.
                    .drawWithContent {
                        clipRect(top = -size.height * 4, bottom = size.height) { this@drawWithContent.drawContent() }
                    },
            ) {
                val top = loop.band()
                translate(top = slab) { drawPath(top, side) }
                drawPath(top, color)
                // The rider: a chevron on the band pointing the way it goes.
                val tangent = loop.tangent(loop.markerAngle)
                val angle = Math.toDegrees(atan2(tangent.y, tangent.x).toDouble()).toFloat()
                rotate(angle + 90f, pivot = marker) {
                    val s = loop.band * 0.36f
                    val chevron = Path().apply {
                        moveTo(marker.x - s, marker.y + s * 0.6f)
                        lineTo(marker.x, marker.y - s * 0.6f)
                        lineTo(marker.x + s, marker.y + s * 0.6f)
                    }
                    drawPath(chevron, BoardInk, style = Stroke(width = s * 0.7f, cap = StrokeCap.Round))
                }
            }

            pids.upcoming.forEachIndexed { i, stop ->
                val (at, size) = bubbles[i]
                StopBubble(
                    stop = stop,
                    size = with(density) { size.toDp() },
                    modifier = Modifier.offset { IntOffset((at.x - size / 2).roundToInt(), (at.y - size / 2).roundToInt()) },
                )
                StopLabel(
                    stop = stop,
                    x = starts[i],
                    centreY = at.y,
                    maxWidth = (width - starts[i] - gap).roundToInt(),
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
}

/**
 * The loop on the ground, as seen from 45° up: a circle squashed to [TILT] of its height, and far
 * bigger than the screen. Its upright near side lies off the strip's left edge and below it, so the
 * band only ever comes in through the left edge; it climbs steeply where the stops are and sweeps
 * right, on past the strip's top to [FAR_ANGLE], under the plate. The strip's [height] is whatever
 * that leaves, down to just below where the band comes in.
 *
 * Stops are spaced evenly up the screen rather than evenly round the loop: projected, equal steps
 * round it bunch the far stops together.
 */
private class GroundLoop(
    width: Float,
    val band: Float,
    private val offscreen: Float,
    nearestIn: Float,
    markerIn: Float,
    private val pitch: Float,
    farthestTop: Float,
    entryMargin: Float,
) {

    private val radius = width * LOOP_RADIUS
    private val cx = radius - offscreen

    /** The angle round the loop at which the band's centre is [inset] in from the left edge. */
    private fun angleAt(inset: Float) = acos((1 - (inset + offscreen) / radius).coerceIn(-1f, 1f))

    private val nearestAngle = angleAt(nearestIn)
    val markerAngle = angleAt(markerIn)

    private val nearestY = farthestTop + (PIDS_STOPS - 1) * pitch
    private val cy = nearestY + TILT * radius * sin(nearestAngle)

    /** Down to just below where the band's lower edge comes in off the left edge. */
    val height: Float = run {
        val inner = radius - band / 2
        cy - TILT * inner * sin(acos((cx / inner).coerceIn(-1f, 1f))) + entryMargin
    }

    fun point(angle: Float, r: Float = radius) = Offset(cx - r * cos(angle), cy - TILT * r * sin(angle))

    /** Stop [index] (0 the nearest), a pitch above the one before it. */
    fun stop(index: Int): Offset {
        val y = nearestY - index * pitch
        return point(asin(((cy - y) / (TILT * radius)).coerceIn(-1f, 1f)))
    }

    /**
     * Where the band's inner (lower right) edge has climbed above [y]: anything right of this, below
     * [y], is clear of the band. The edge only rises as it goes right, so one crossing settles it.
     */
    fun innerEdgeClearOf(y: Float): Float {
        val r = radius - band / 2
        val angle = asin(((cy - y) / (TILT * r)).coerceIn(0f, 1f))
        return cx - r * cos(angle)
    }

    /** The way the band runs at [angle], up and to the right. */
    fun tangent(angle: Float) = Offset(radius * sin(angle), -TILT * radius * cos(angle))

    /** The band's top face, between the loop's inner and outer edges. */
    fun band(): Path = Path().apply {
        val steps = 160
        val angles = (0..steps).map { NEAR_ANGLE + (FAR_ANGLE - NEAR_ANGLE) * it / steps }
        angles.forEachIndexed { i, a ->
            val (x, y) = point(a, radius + band / 2)
            if (i == 0) moveTo(x, y) else lineTo(x, y)
        }
        angles.asReversed().forEach { a ->
            val (x, y) = point(a, radius - band / 2)
            lineTo(x, y)
        }
        close()
    }

    private companion object {
        /** cos 45°: the ground seen from halfway between overhead and edge-on. */
        const val TILT = 0.707f
        const val NEAR_ANGLE = -0.25f
        const val FAR_ANGLE = 1.2f
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

/** A stop's name, its vertical centre on [centreY] (its bubble's), starting at [x]; "TURUN" under the stop to get off at. */
@Composable
private fun StopLabel(stop: PidsStop, x: Float, centreY: Float, maxWidth: Int) {
    val density = LocalDensity.current
    // Centred optically: the middle of the name's capitals on the bubble's centre, measured from its
    // baseline at the size it settled on. Its line box would centre the room a "g" might need, and
    // set "Duren Kalibata" high.
    var capHalf by remember { mutableFloatStateOf(0f) }
    Column(
        modifier = Modifier.layout { measurable, _ ->
            val placeable = measurable.measure(Constraints(maxWidth = maxWidth.coerceAtLeast(0)))
            val baseline = placeable[FirstBaseline].takeIf { it != AlignmentLine.Unspecified } ?: (placeable.height / 2)
            layout(placeable.width, placeable.height) {
                placeable.place(x.roundToInt(), (centreY - baseline + capHalf).roundToInt())
            }
        },
    ) {
        // A long name shrinks to the room it has rather than lose its end: "Pasar Minggu B…" is no use.
        BasicText(
            text = stop.name,
            // On the theme's type, as BasicText alone falls back to the platform's.
            style = MaterialTheme.typography.titleLarge.merge(
                color = PlainText,
                fontWeight = if (stop.next || stop.alighting) FontWeight.Bold else FontWeight.SemiBold,
                lineHeight = if (stop.next) 30.sp else 24.sp,
            ),
            maxLines = 1,
            // Only past the smallest size does a name lose its end, and then visibly.
            overflow = TextOverflow.Ellipsis,
            autoSize = TextAutoSize.StepBased(minFontSize = 13.sp, maxFontSize = if (stop.next) NextNameSize else NameSize, stepSize = 1.sp),
            onTextLayout = { layout -> capHalf = with(density) { layout.layoutInput.style.fontSize.toPx() } * CAP_HEIGHT / 2 },
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
    // Where the rider boards or has arrived there's nothing to change to: "Pindah di" would mislead.
    if (pids.label == PidsLabel.BOARD || pids.label == PidsLabel.ARRIVED) return
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
