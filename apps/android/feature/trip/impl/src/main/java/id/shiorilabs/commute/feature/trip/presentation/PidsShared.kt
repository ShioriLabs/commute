package id.shiorilabs.commute.feature.trip.presentation

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Transition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.motion.IosSpringEasing
import id.shiorilabs.commute.core.ui.motion.rememberReducedMotion
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.R
import kotlinx.coroutines.delay

// The pieces any PIDS style, and the finished trip's plate, draw with: see [PidsStyle].

/**
 * Light icons over a dark surface while it's up; the app's dark ones again once the last such
 * surface has gone, so the trip bar leaving as the finished page's plate arrives can't darken
 * them under the plate. Set on every pass too, as the theme sets its own whenever it recomposes.
 */
@Composable
internal fun DarkStatusBarIcons() {
    val view = LocalView.current
    val controller = remember(view) {
        view.context.findActivity()?.window?.let { WindowCompat.getInsetsController(it, view) }
    }
    SideEffect { controller?.isAppearanceLightStatusBars = false }
    DisposableEffect(controller) {
        darkSurfaces++
        controller?.isAppearanceLightStatusBars = false
        onDispose {
            darkSurfaces--
            if (darkSurfaces == 0) controller?.isAppearanceLightStatusBars = true
        }
    }
}

/** How many dark surfaces are up under the status bar. Only touched on the main thread. */
private var darkSurfaces = 0

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** [TripCopy.direction], read where there's no copy to hand. */
@Composable
internal fun rideDirection(ride: TripLeg.Ride): String? = ride.sharedHeadsign?.let { stringResource(R.string.trip_headsign, it) }
    ?: ride.takeIf { it.otherLines > 0 }?.let { stringResource(R.string.trip_via, it.stops.last().name) }

/**
 * The big name on one line, shrinking as far as it still reads big. A name too long even then
 * ("Bandara Internasional Soekarno-Hatta") is split at its word breaks into lines that each fit,
 * and they take turns sliding up into place.
 */
@Composable
internal fun StationName(name: String, modifier: Modifier = Modifier) {
    val style = MaterialTheme.typography.headlineLarge.merge(color = Color.White, fontWeight = FontWeight.Bold, lineHeight = 52.sp)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints(
        modifier = modifier.clearAndSetSemantics {
            heading()
            contentDescription = name
        },
    ) {
        val pages = remember(name, style, constraints.maxWidth, density) { namePages(measurer, name, style, constraints.maxWidth) }
        if (pages == null) {
            BasicText(
                text = name,
                style = style,
                maxLines = 1,
                autoSize = TextAutoSize.StepBased(minFontSize = NameMin, maxFontSize = NameMax, stepSize = 2.sp),
            )
        } else {
            SlidingPages(pages = pages.lines, holdMillis = NAME_PAGE_MILLIS, fade = 8.dp) { line ->
                BasicText(text = line, style = style.merge(fontSize = pages.size), maxLines = 1, softWrap = false)
            }
        }
    }
}

/**
 * [count] pages taking turns in one line's room, as Kaohsiung's metro displays page a long
 * message: each holds for [holdMillis], then slides up out of the way as the next slides up into
 * place, both softened over [fade] at the edges they cross. With animations off they swap without
 * moving.
 */
@Composable
internal fun <T> SlidingPages(
    pages: List<T>,
    holdMillis: Long,
    fade: Dp,
    modifier: Modifier = Modifier,
    content: @Composable (page: T) -> Unit,
) {
    val count = pages.size
    var page by remember(count) { mutableIntStateOf(0) }
    LaunchedEffect(count) {
        if (count < 2) return@LaunchedEffect
        while (true) {
            delay(holdMillis)
            page = (page + 1) % count
        }
    }
    // Slides between the pages themselves, not their places: one sliding out after the pages have
    // changed (a line dropped as the stop to get off at comes up) still draws what it said.
    val shown = page.coerceAtMost(count - 1)
    PageSlide(updateTransition(IndexedValue(shown, pages[shown]), label = "slidingPages"), fade, modifier) { content(it.value) }
}

/** [transition]'s states as pages, each new one sliding up into place as [SlidingPages] does. */
@Composable
internal fun <S> PageSlide(
    transition: Transition<S>,
    fade: Dp,
    modifier: Modifier = Modifier,
    content: @Composable (S) -> Unit,
) {
    val reducedMotion = rememberReducedMotion()
    val sliding = transition.currentState != transition.targetState
    transition.AnimatedContent(
        modifier = modifier
            .clipToBounds()
            // Offscreen, so the edges can be faded out of what's drawn, not painted over.
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                if (sliding) {
                    val edge = (fade.toPx() / size.height).coerceIn(0f, 0.5f)
                    drawRect(
                        brush = Brush.verticalGradient(0f to Color.Transparent, edge to Color.Black, 1f - edge to Color.Black, 1f to Color.Transparent),
                        blendMode = BlendMode.DstIn,
                    )
                }
            },
        transitionSpec = {
            if (reducedMotion) {
                EnterTransition.None togetherWith ExitTransition.None
            } else {
                val move = tween<IntOffset>(PAGE_SLIDE_MILLIS, easing = IosSpringEasing)
                val fadeSpec = tween<Float>(PAGE_SLIDE_MILLIS, easing = IosSpringEasing)
                (slideInVertically(move) { it } + fadeIn(fadeSpec)) togetherWith (slideOutVertically(move) { -it } + fadeOut(fadeSpec))
            }
        },
        contentAlignment = Alignment.CenterStart,
    ) { state -> content(state) }
}

/** A long name's lines, each shown in turn, all at one [size]. */
private class NamePages(val size: TextUnit, val lines: List<String>)

/**
 * How [name] splits to fit [width]: `null` when it fits whole on one line at [NameMin] or bigger.
 * Otherwise the biggest size, down to [PageMin], whose lines break only between words and number
 * no more than [NAME_PAGES_MAX]; failing that, the fewest lines at [PageMin], broken wherever.
 */
private fun namePages(measurer: TextMeasurer, name: String, style: TextStyle, width: Int): NamePages? {
    val whole = measurer.measure(name, style.merge(fontSize = NameMin), maxLines = 1, softWrap = false)
    if (whole.size.width <= width) return null
    fun linesAt(size: TextUnit): List<String> {
        val layout = measurer.measure(name, style.merge(fontSize = size), constraints = Constraints(maxWidth = width))
        return (0 until layout.lineCount).map { name.substring(layout.getLineStart(it), layout.getLineEnd(it)) }
    }
    var size = NameMax.value
    while (size >= PageMin.value) {
        val lines = linesAt(size.sp)
        // A break inside a word ("Internasi-onal") doesn't count as fitting.
        val betweenWords = lines.dropLast(1).all { it.last().isWhitespace() || it.last() == '-' }
        if (betweenWords && lines.size <= NAME_PAGES_MAX) return NamePages(size.sp, lines.map(String::trim))
        size -= 2
    }
    return NamePages(PageMin, linesAt(PageMin).map(String::trim))
}

/** The big name's range on one line; below the least it splits into lines instead. */
private val NameMin = 32.sp
private val NameMax = 48.sp

/** The least a split name's lines go, and the most lines it takes turns in. */
private val PageMin = 26.sp
private const val NAME_PAGES_MAX = 3

/** How long each line of a split name holds, and each turn of the line over it. */
private const val NAME_PAGE_MILLIS = 2500L
internal const val EYEBROW_PAGE_MILLIS = 4000L

/** How long a page takes to slide up into place. */
private const val PAGE_SLIDE_MILLIS = 450

/** The station's lines as roundels before its name, the ride's own first. */
@Composable
internal fun StationLines(keys: List<String>, lines: Map<String, LineInfo>) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        keys.forEach { key ->
            val info = lines[key]
            LineRoundel(
                code = info?.lineCode ?: key.substringAfter(':'),
                color = info?.colorCode ?: "#94A3B8",
                operator = key.substringBefore(':'),
                size = RoundelSize.MD,
            )
        }
    }
}

internal val PidsLabel.text: Int
    get() = when (this) {
        PidsLabel.WALK -> R.string.trip_pids_walk
        PidsLabel.BOARD -> R.string.trip_pids_board
        PidsLabel.AT -> R.string.trip_pids_at
        PidsLabel.NEXT -> R.string.trip_pids_next
        PidsLabel.ALIGHT_NEXT -> R.string.trip_pids_alight_next
        PidsLabel.ALIGHT_HERE -> R.string.trip_pids_alight_here
        PidsLabel.ARRIVED -> R.string.trip_pids_arrived
    }
