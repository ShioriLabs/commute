package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.updateTransition
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import id.shiorilabs.commute.core.ui.ext.lineColorOf
import kotlinx.coroutines.delay
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.zIndex
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
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
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.motion.IosSpringEasing
import id.shiorilabs.commute.core.ui.motion.rememberReducedMotion
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.presentation.components.PidsChevrons
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.trip.R
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.roundToInt

/** Near-black, like the band over a JR East display. */
private val BoardInk = Color(0xFF0F172A)
private val BoardMuted = Color(0xFF94A3B8)
private val BoardDim = Color(0xFF64748B)
private val PlainText = Color(0xFF0F172A)
private val Hairline = Color(0x33FFFFFF)

/** Off the timetable, on the dark plate: late in a soft red, early in a soft green. */
private val BoardLate = Color(0xFFFB7185)
private val BoardEarly = Color(0xFF34D399)

/** Figures of one width, so minutes and clocks don't shift as they tick. */
private const val TABULAR = "tnum"

/** The most lines marked before a station's name: more would crowd it out. */
private const val STATION_LINES = 3

/** The next stop's bubble, the display's yellow. */
private val NextStop = Color(0xFFFBBF24)

/** The band before its colour reaches it, top and side. */
private val BandUnlit = Color(0xFFCBD5E1)
private val BandUnlitSide = Color(0xFF94A3B8)

private const val DRAW_IN_MILLIS = 1100

/** The white edge round the rider's pink marker. */
private val MarkerOutline = 2.dp

/** One run of the rider's marker toward the next stop, and the shares of it spent fading in and out. */
private const val TRAVEL_MILLIS = 1600

/** The wait after each marker step: the next frame after it is the second on 120 Hz, the next on 60. */
private const val MARKER_STEP_MILLIS = 12L
private const val MARKER_FADE_IN = 0.12f
private const val MARKER_FADE_OUT = 0.18f

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

/** Plus Jakarta Sans' capitals, as a share of its size: what a name hangs by. */
private const val CAP_HEIGHT = 0.7f

/** Keeps a white bubble apart from a pale line (a yellow corridor) and the page around it. */
private val BubbleRing = Color(0x1F0F172A)

/**
 * [PidsStyle.BekasiRailway]'s in-train display: a dark band naming the next station, over the
 * line's own colour carrying the stops ahead, nearest at the bottom. Adapted from JR East's for a
 * phone held upright, so the band rises up the left and the names read to its right.
 */
@Composable
internal fun BekasiRailwayBoard(
    style: PidsStyle.BekasiRailway,
    pids: Pids,
    lines: Map<String, LineInfo>,
    /** The lines at [Pids.stationId], keyed `OPERATOR:CODE`, for "bisa pindah ke". */
    stationLines: List<String>,
    copy: TripCopy,
    source: String?,
    /** Where the big name's bottom edge is in the root, as the page scrolls; see [BekasiRailwayBar]. */
    onNameMoved: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val line = lines[pids.ride.line]
    val color = lineColorOf(line?.colorCode)
    Column(modifier = modifier.fillMaxWidth()) {
        // Over the strip: its band runs on up behind the plate.
        Plate(pids, lines, stationLines, onNameMoved, modifier = Modifier.zIndex(1f))
        if (style.diagram && pids.upcoming.isNotEmpty()) {
            if (style.pages) BoardPages(pids, color, source) else Strip(pids, color, source)
        }
        ChangePanel(pids, lines, stationLines, copy)
    }
}

/** What the area under the plate shows in its turn: the route, and (for now) a placeholder. */
private enum class BoardPage { ROUTE, HELLO }

/**
 * The area under the plate taking turns between pages, as a real display moves between the route
 * and its other screens. It keeps the route's height throughout, so nothing below it moves; the
 * route draws itself in again each time it comes back round.
 */
@Composable
private fun BoardPages(pids: Pids, color: Color, source: String?) {
    val pages = BoardPage.entries
    var turn by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(BOARD_PAGE_MILLIS)
            turn++
        }
    }
    val page = pages[turn % pages.size]
    val reducedMotion = rememberReducedMotion()
    val fadeSpec = tween<Float>(if (reducedMotion) 0 else BOARD_FADE_MILLIS)
    val routeAlpha by animateFloatAsState(if (page == BoardPage.ROUTE) 1f else 0f, fadeSpec, label = "routeAlpha")
    val helloAlpha by animateFloatAsState(if (page == BoardPage.HELLO) 1f else 0f, fadeSpec, label = "helloAlpha")
    Box(modifier = Modifier.fillMaxWidth()) {
        // Laid out always, for the height; only shown in its turn.
        Strip(
            pids = pids,
            color = color,
            source = source,
            replay = turn / pages.size,
            modifier = Modifier.graphicsLayer { alpha = routeAlpha },
        )
        if (helloAlpha > 0f) {
            HelloPage(modifier = Modifier.matchParentSize().graphicsLayer { alpha = helloAlpha })
        }
    }
}

/** A stand-in for the display's other screens, to try the turns out with. */
@Composable
private fun HelloPage(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Halo, dunia!",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = PlainText,
        )
        Text(
            text = "Hello, world!",
            modifier = Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.titleMedium,
            color = BoardDim,
        )
    }
}

/** How long each page under the plate holds, and how long they take to cross-fade. */
private const val BOARD_PAGE_MILLIS = 8000L
private const val BOARD_FADE_MILLIS = 400

/**
 * [PidsStyle.BekasiRailway]'s bar over every screen while a trip runs, after the long strip
 * displays over train doors: the line's roundel, where it's headed, and the minutes to getting off.
 * On the trip page it is the top of the plate, pinned as the page scrolls under it, with a close
 * button; anywhere else the whole bar opens the trip. Once the big name is out of sight
 * ([collapsed], and always off the trip page), the name takes turns with where it's headed, so the
 * bar still says where to go.
 */
@Composable
internal fun BekasiRailwayBar(
    pids: Pids,
    lines: Map<String, LineInfo>,
    copy: TripCopy,
    topInset: Dp,
    collapsed: Boolean,
    onTripPage: Boolean,
    onClose: () -> Unit,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    DarkStatusBarIcons()
    // The bubbles count down to each stop; the corner, and the clock under the name, to getting off.
    val minutes = pids.minutesLeft
    val clock = pids.alightingAt?.let(::formatClock)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(BoardInk)
            .padding(top = topInset)
            .padding(top = 4.dp),
    ) {
        val openLabel = stringResource(R.string.trip_bar_open)
        Row(
            modifier = Modifier
                .clickable(enabled = !onTripPage, onClickLabel = openLabel, role = Role.Button, onClick = onOpen)
                .padding(start = 20.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val rideName = copy.rideName(pids.ride)
            Roundel(pids.ride, lines, modifier = Modifier.semantics { contentDescription = rideName })
            BarTitle(pids, collapsed, modifier = Modifier.padding(start = 10.dp).weight(1f))
            // How long until getting off, by the button: the minutes, or the clock without them.
            when {
                minutes != null -> Row(modifier = Modifier.padding(start = 8.dp)) {
                    Text(
                        text = minutes.toString(),
                        modifier = Modifier.alignByBaseline(),
                        style = MaterialTheme.typography.headlineSmall.merge(fontFeatureSettings = TABULAR),
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                    Text(
                        text = stringResource(R.string.trip_pids_minutes),
                        modifier = Modifier.padding(start = 4.dp).alignByBaseline(),
                        style = MaterialTheme.typography.labelLarge,
                        color = BoardMuted,
                    )
                }
                clock != null -> Text(
                    text = clock,
                    modifier = Modifier.padding(start = 8.dp),
                    style = MaterialTheme.typography.headlineSmall.merge(fontFeatureSettings = TABULAR),
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
            if (onTripPage) {
                CommuteCloseButton(
                    onClick = onClose,
                    contentDescription = stringResource(R.string.trip_live_close),
                    size = 40.dp,
                    tint = Color.White,
                )
            } else {
                // The close button's room, so the minutes stay put going in and out of the trip.
                Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(20.dp), tint = BoardMuted)
                }
            }
        }
        Box(
            modifier = Modifier
                .padding(top = 4.dp)
                .fillMaxWidth()
                .height(1.dp)
                .background(Hairline),
        )
    }
}

/**
 * The bar's line beside the roundel: where the ride is headed (one bus route by its corridor, "Kor
 * L13E"), and once the big name is out of sight, that name ("Naik di Cakung") first, then the two
 * taking turns as the eyebrow does.
 */
@Composable
private fun BarTitle(pids: Pids, collapsed: Boolean, modifier: Modifier = Modifier) {
    val ride = pids.ride
    val headsign = if (ride.isBus && ride.otherLines == 0) {
        stringResource(R.string.trip_corridor_short, ride.line.substringAfter(':'))
    } else {
        rideDirection(ride)
    }
    val label = stringResource(pids.label.text)
    val station = buildAnnotatedString {
        withStyle(SpanStyle(color = BoardMuted)) { append(label) }
        append(" ")
        append(pids.station)
    }
    val style = MaterialTheme.typography.titleSmall.merge(color = Color.White, fontWeight = FontWeight.Bold)
    fun pages(showsName: Boolean) =
        if (showsName) listOfNotNull(station, headsign?.let(::AnnotatedString)) else listOf(AnnotatedString(headsign.orEmpty()))
    PageSlide(
        transition = updateTransition(collapsed, label = "barTitle"),
        fade = 3.dp,
        modifier = modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = pages(collapsed).joinToString(". ") },
    ) { showsName ->
        // Each side of the swap draws its own pages, so the one sliding out keeps what it said.
        val shown = pages(showsName)
        SlidingPages(pages = shown, holdMillis = EYEBROW_PAGE_MILLIS, fade = 3.dp, modifier = Modifier.fillMaxWidth()) { text ->
            BasicText(text = text, style = style, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * The rest of the plate, under the bar: what's next and the big name, with the station's lines as
 * roundels before it, as Singapore's MRT marks a station, then the platform and the clock.
 */
@Composable
private fun Plate(
    pids: Pids,
    lines: Map<String, LineInfo>,
    stationLines: List<String>,
    onNameMoved: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val minutes = pids.minutesLeft
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(BoardInk)
            .padding(bottom = 16.dp),
    ) {
        Column(modifier = Modifier.padding(start = 20.dp, top = 12.dp, end = 20.dp)) {
            Eyebrow(pids)
            Row(
                modifier = Modifier
                    .padding(top = 2.dp)
                    .onGloballyPositioned { onNameMoved(it.positionInRoot().y + it.size.height) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StationLines((listOf(pids.ride.line) + stationLines).distinct().take(STATION_LINES), lines)
                StationName(pids.station, modifier = Modifier.weight(1f).padding(start = 10.dp))
            }
        }
        // Still to board, on haltes several routes serve (or shared track): whichever comes first.
        if ((pids.label == PidsLabel.BOARD || pids.label == PidsLabel.WALK) && pids.ride.otherLines > 0) {
            AnyLine(pids.ride, lines)
        }
        // The plainer facts: the platform while waiting for it, and the clock (when the minutes are
        // up by the close button) at the far end.
        val platform = pids.ride.platformCode?.takeIf { pids.label == PidsLabel.BOARD || pids.label == PidsLabel.WALK }
        val at = pids.alightingAt.takeIf { minutes != null }
        if (platform != null || at != null) {
            Row(modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 6.dp, end = 20.dp)) {
                Text(
                    text = platform?.let { stringResource(R.string.trip_platform, formatPlatformCode(it)) }.orEmpty(),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelLarge,
                    color = BoardMuted,
                )
                at?.let {
                    TimetableTime(
                        scheduled = pids.alightingScheduled,
                        actual = it,
                        style = MaterialTheme.typography.labelLarge.merge(fontFeatureSettings = TABULAR),
                        color = BoardMuted,
                        struck = BoardDim,
                        late = BoardLate,
                        early = BoardEarly,
                    )
                }
            }
        }
    }
}


/** "Naik salah satu bus", and the roundel of every line that will do, the planned one first. */
@Composable
private fun AnyLine(ride: TripLeg.Ride, lines: Map<String, LineInfo>) {
    Column(modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 8.dp, end = 20.dp)) {
        Text(
            text = stringResource(if (ride.isBus) R.string.trip_board_any_bus else R.string.trip_board_any_train),
            style = MaterialTheme.typography.labelLarge,
            color = BoardMuted,
        )
        FlowRow(
            modifier = Modifier.padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ride.lineKeys.forEach { key ->
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

/**
 * The line over the big name. Waiting or riding with stops to go, it takes turns with where to get
 * off and how many stops are left ("Berikutnya" ↔ "Turun di Depok · 7 stasiun lagi"), sliding up
 * as the big name's lines do.
 */
@Composable
private fun Eyebrow(pids: Pids) {
    val label = stringResource(pids.label.text)
    val ahead = if (pids.label == PidsLabel.WALK && pids.walkM != null && pids.walkMinutes != null) {
        stringResource(R.string.trip_pids_walk_ahead, pids.walkM, pids.walkMinutes)
    } else {
        pids.takeIf { it.label == PidsLabel.BOARD || it.label == PidsLabel.AT || it.label == PidsLabel.NEXT }?.let {
            stringResource(
                if (it.ride.isBus) R.string.trip_ride_to_halte else R.string.trip_ride_to_station,
                it.ride.stops.last().name,
                it.stopsLeft,
            )
        }
    }
    val pages = listOfNotNull(label, ahead)
    val style = MaterialTheme.typography.titleSmall.merge(color = BoardMuted, fontWeight = FontWeight.Bold)
    val alighting = pids.label == PidsLabel.ALIGHT_HERE || pids.label == PidsLabel.ALIGHT_NEXT
    SlidingPages(
        pages = pages,
        holdMillis = EYEBROW_PAGE_MILLIS,
        fade = 3.dp,
        modifier = Modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = pages.joinToString(". ") },
    ) { text ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BasicText(text = text, style = style, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (alighting && text == label) {
                PidsChevrons(color = NextStop)
            }
        }
    }
}



/**
 * The band and its stops: a stretch of a loop lying on the ground, seen from 45° above, as JR East
 * draws the Yamanote line. The band comes in from off the left edge and sweeps away to the right under
 * the plate, both its ends out of view. Orthographic, so nothing shrinks with
 * distance; the band thins where it turns across the view, and a darker side face shows it as a
 * slab on the ground. The nearest stop is at the bottom, the rider's marker below it.
 */
@Composable
private fun Strip(
    pids: Pids,
    color: Color,
    source: String?,
    /** Bumped each time the route comes back round on the board, to draw it in again. */
    replay: Int = 0,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    // The band draws itself in, grey first and then the line's colour sweeping from the rider to the
    // far end, as the display does each time it shows the stops ahead: on opening, and again when
    // the next stop changes.
    // With animations off, both hold still in their finished state: the band whole, the marker
    // halfway to the stop.
    val reducedMotion = rememberReducedMotion()
    val drawIn = remember { Animatable(0f) }
    LaunchedEffect(pids.station, reducedMotion, replay) {
        if (reducedMotion) {
            drawIn.snapTo(1f)
            return@LaunchedEffect
        }
        drawIn.snapTo(0f)
        // The app's iOS spring: off at speed and settling as it goes, no ease-in to stall the start.
        drawIn.animateTo(1f, tween(durationMillis = DRAW_IN_MILLIS, easing = IosSpringEasing))
    }
    // The rider's marker runs along the band toward the next stop, eases in short of its bubble and
    // starts again: heading this way, over and over.
    // Time runs evenly; the position eases off it, the fades don't. Fading by the eased position
    // would leave the marker faint for half of every run, while it slows toward the stop.
    // Read only while drawing: the marker moves every frame, and reading it here would recompose
    // the whole board with it. It steps at about 60 a second rather than every frame of a 120 Hz
    // display: it runs for as long as the board is open, and half the frames is half the drawing.
    val clock = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(reducedMotion) {
        if (reducedMotion) return@LaunchedEffect
        val start = withFrameMillis { it }
        while (true) {
            withFrameMillis { now -> clock.floatValue = (now - start) % TRAVEL_MILLIS / TRAVEL_MILLIS.toFloat() }
            delay(MARKER_STEP_MILLIS)
        }
    }
    val description = stringResource(R.string.trip_pids_description, pids.upcoming.joinToString { it.name })
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
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
        val outline = with(density) { MarkerOutline.toPx() }
        val brand = MaterialTheme.colorScheme.primary
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
            // The name hangs from the bubble's centre line, and the band's edge only rises going
            // right: clear of it at that line, the name is clear all the way down, and so is the
            // tag under the stop to get off at.
            maxOf(at.x + size / 2, loop.innerEdgeClearOf(at.y - slab)) + gap
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(with(density) { loop.height.toDp() })
                .clearAndSetSemantics { contentDescription = description },
        ) {
            Spacer(
                modifier = Modifier
                    .matchParentSize()
                    // Below the strip is the page; above it the plate, which draws over the band.
                    .drawWithContent {
                        clipRect(top = -size.height * 4, bottom = size.height) { this@drawWithContent.drawContent() }
                    }
                    // The band's paths are built once, and again only while the draw-in moves them;
                    // a new path each frame would be tessellated afresh each frame.
                    .drawWithCache {
                        // Grey underneath, the line's colour over it as far as the draw-in has reached.
                        val whole = loop.band()
                        val lit = loop.band(drawIn.value)
                        val s = loop.band * 0.36f
                        val reach = loop.angleShortOfNearest(bubbles.firstOrNull()?.second?.div(2) ?: 0f, gap = s)
                        val outlineStroke = Stroke(width = s * 0.7f + outline * 2, cap = StrokeCap.Round, join = StrokeJoin.Round)
                        val fillStroke = Stroke(width = s * 0.7f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                        val chevron = Path()
                        val fade = Paint()
                        onDrawBehind {
                            translate(top = slab) { drawPath(whole, BandUnlitSide) }
                            drawPath(whole, BandUnlit)
                            translate(top = slab) { drawPath(lit, side) }
                            drawPath(lit, color)
                            // The rider: a chevron on the band pointing the way it goes, from just in off
                            // the edge to just short of the next stop's bubble, fading in as it sets off
                            // and out as it arrives so the loop has no seam.
                            val time = if (reducedMotion) 0.5f else clock.value
                            val markerAngle = loop.markerAngle + (reach - loop.markerAngle) * IosSpringEasing.transform(time)
                            val marker = loop.point(markerAngle)
                            val tangent = loop.tangent(markerAngle)
                            val angle = Math.toDegrees(atan2(tangent.y, tangent.x).toDouble()).toFloat()
                            fade.alpha = when {
                                reducedMotion -> 1f
                                time < MARKER_FADE_IN -> time / MARKER_FADE_IN
                                time > 1f - MARKER_FADE_OUT -> (1f - time) / MARKER_FADE_OUT
                                else -> 1f
                            }
                            rotate(angle + 90f, pivot = marker) {
                                chevron.reset()
                                chevron.moveTo(marker.x - s, marker.y + s * 0.6f)
                                chevron.lineTo(marker.x, marker.y - s * 0.6f)
                                chevron.lineTo(marker.x + s, marker.y + s * 0.6f)
                                // Brand pink, outlined in white so it holds up on any line's colour. Faded
                                // as one layer, so the outline doesn't show through the pink on the way in
                                // and out.
                                drawContext.canvas.saveLayer(Rect(marker, s * 2 + outline * 2), fade)
                                drawPath(chevron, Color.White, style = outlineStroke)
                                drawPath(chevron, brand, style = fillStroke)
                                drawContext.canvas.restore()
                            }
                        }
                    },
            )

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

    /** The angle [gap] short of the nearest stop's bubble of radius [bubbleRadius], measured along the band. */
    fun angleShortOfNearest(bubbleRadius: Float, gap: Float): Float {
        val (dx, dy) = tangent(nearestAngle)
        val perRadian = kotlin.math.sqrt(dx * dx + dy * dy)
        return (nearestAngle - (bubbleRadius + gap) / perRadian).coerceAtLeast(markerAngle)
    }
    val markerAngle = angleAt(markerIn)

    /** Where the band's outer edge comes in over the left edge: the start of what can be seen of it. */
    private val entryAngle by lazy { acos((cx / (radius + band / 2)).coerceIn(-1f, 1f)) }

    /**
     * The band from where it comes on screen to its far end, measured along it: each sample's
     * distance from the start, so a share of the sweep turns into an angle at an even pace. On the
     * squashed loop, equal angles aren't equal lengths.
     */
    private val lengths: FloatArray by lazy {
        FloatArray(LENGTH_SAMPLES + 1).also { lengths ->
            var previous = point(entryAngle)
            for (i in 1..LENGTH_SAMPLES) {
                val next = point(entryAngle + (FAR_ANGLE - entryAngle) * i / LENGTH_SAMPLES)
                lengths[i] = lengths[i - 1] + (next - previous).getDistance()
                previous = next
            }
        }
    }

    /** The angle [fraction] of the way along the band from where it comes on screen, by length. */
    private fun angleAlongBand(fraction: Float): Float {
        val target = lengths.last() * fraction.coerceIn(0f, 1f)
        val i = lengths.indexOfFirst { it >= target }.coerceAtLeast(1)
        val span = lengths[i] - lengths[i - 1]
        val within = if (span > 0f) (target - lengths[i - 1]) / span else 0f
        return entryAngle + (FAR_ANGLE - entryAngle) * (i - 1 + within) / LENGTH_SAMPLES
    }

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

    /**
     * The band's top face, between the loop's inner and outer edges: the whole of it, or its near
     * [fraction] (by angle round the loop) while it draws in.
     */
    fun band(fraction: Float = 1f): Path = Path().apply {
        // The sweep runs from where the band comes on screen to its far end, under the plate, at
        // an even pace along it; the tail off the left edge comes lit from the start.
        val far = if (fraction >= 1f) FAR_ANGLE else angleAlongBand(fraction.coerceAtLeast(0f))
        val steps = maxOf(2, (160 * fraction).roundToInt())
        val angles = (0..steps).map { NEAR_ANGLE + (far - NEAR_ANGLE) * it / steps }
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
        const val LENGTH_SAMPLES = 96
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

/** A stop's name hanging from [centreY] (its bubble's centre), starting at [x]; "TURUN" under the stop to get off at. */
@Composable
private fun StopLabel(stop: PidsStop, x: Float, centreY: Float, maxWidth: Int) {
    val density = LocalDensity.current
    // The top of the name's capitals on the bubble's centre line, measured from its baseline at the
    // size it settled on: its ink, not its line box, which has room above for accents.
    var capHeight by remember { mutableFloatStateOf(0f) }
    Column(
        modifier = Modifier.layout { measurable, _ ->
            val placeable = measurable.measure(Constraints(maxWidth = maxWidth.coerceAtLeast(0)))
            val baseline = placeable[FirstBaseline].takeIf { it != AlignmentLine.Unspecified } ?: (placeable.height / 2)
            layout(placeable.width, placeable.height) {
                placeable.place(x.roundToInt(), (centreY - baseline + capHeight).roundToInt())
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
            onTextLayout = { layout -> capHeight = with(density) { layout.layoutInput.style.fontSize.toPx() } * CAP_HEIGHT },
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
 * there, or else the other lines a rider could change to. A change that leaves from another
 * station says to walk there first: "Pindah di Sudirman" for an LRT out of Dukuh Atas misled.
 */
@Composable
private fun ChangePanel(pids: Pids, lines: Map<String, LineInfo>, stationLines: List<String>, copy: TripCopy) {
    // Where the rider boards or has arrived there's nothing to change to: "Pindah di" would mislead.
    if (pids.label == PidsLabel.WALK || pids.label == PidsLabel.BOARD || pids.label == PidsLabel.ARRIVED) return
    val change = pids.changeTo
    val others = stationLines.filter { it != pids.ride.line }
    if (change == null && others.isEmpty()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(PaddingValues(start = 32.dp, end = 32.dp, top = 8.dp)),
    ) {
        val walk = pids.changeWalk
        Text(
            text = if (walk != null) {
                stringResource(R.string.trip_pids_change_walk, walk.distanceM, walk.to.name)
            } else {
                stringResource(R.string.trip_pids_change_at, pids.station)
            },
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
                        change.platformCode?.let { stringResource(R.string.trip_platform, formatPlatformCode(it)) },
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
private fun Roundel(ride: TripLeg.Ride, lines: Map<String, LineInfo>, modifier: Modifier = Modifier) {
    val info = lines[ride.line]
    LineRoundel(
        code = info?.lineCode ?: ride.line.substringAfter(':'),
        color = info?.colorCode ?: "#94A3B8",
        modifier = modifier,
        operator = ride.operator,
        size = RoundelSize.SM,
    )
}
