package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.animation.EnterExitState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.motion.PAGE_MILLIS
import id.shiorilabs.commute.core.ui.motion.PageEasing
import id.shiorilabs.commute.feature.station.api.R
import kotlin.math.roundToInt

/**
 * A station's title as it flies between the home feed, where it reads "Stasiun Manggarai", and the
 * station page's header, where it reads "Manggarai". The two ends draw this same text, so it flies
 * as one piece, and the words before the name are clipped in from the start or out to it as the
 * screen enters or leaves: on the way home "Stas", "Stasi", "Stasiun" uncover beside the name while
 * it lands, and on the way out they cover back up.
 *
 * The reveal is drawn, not laid out. Each end keeps the size it has at rest (the feed's the whole
 * title, the page's the name alone), and only what is drawn inside it moves: the words clipped to
 * how much of them shows, and the name shifted by as much. The flight lands on that size, and a size
 * that changed in mid-flight would move the landing spot under it and set the flight off again,
 * behind everything else flying with it.
 *
 * @param showWords whether the words before the name show at rest: on the feed, not on the page.
 * @param animateWords whether they clip in and out with the screen's transition. Only on the two
 *   ends of a flight between feed and page; anywhere else they would replay on every navigation.
 * @param scaleWithFlight whether the title scales to the other end in flight, for an end whose name
 *   is a different size (a search row's), rather than flying at its own size.
 */
@Composable
fun StationTitleText(
    stationId: String,
    name: String,
    style: TextStyle,
    showWords: Boolean,
    modifier: Modifier = Modifier,
    animateWords: Boolean = false,
    shared: Boolean = true,
    scaleWithFlight: Boolean = false,
) {
    val title = stringResource(R.string.station_title, name)
    val nameStart = title.indexOf(name).coerceAtLeast(0)
    val before = title.substring(0, nameStart)
    val after = title.substring((nameStart + name.length).coerceAtMost(title.length))
    val atRest = if (showWords) 1f else 0f
    val shown = wordsShown(atRest, animateWords)
    // The words' whole width, for shifting the name by the part of them that shows. Measured here
    // rather than read back from their layout: a state written during layout took the title a
    // frame longer to settle, and its flight set off a frame behind the line cards.
    val measurer = rememberTextMeasurer()
    val wordsWidth = remember(before, style, measurer) {
        if (before.isEmpty()) 0 else measurer.measure(before, style, maxLines = 1, softWrap = false).size.width
    }

    Row(
        modifier = modifier
            .sharedStationName(stationId, enabled = shared, scaleText = scaleWithFlight)
            .runOnInFlight(),
    ) {
        if (before.isNotEmpty()) {
            Text(
                text = before,
                modifier = Modifier
                    .then(if (showWords) Modifier else Modifier.clearAndSetSemantics {})
                    // Laid out at its size at rest, whatever is showing; measured whole, so it
                    // never wraps.
                    .layout { measurable, constraints ->
                        val placeable = measurable.measure(constraints.copy(minWidth = 0, maxWidth = Constraints.Infinity))
                        layout((placeable.width * atRest).roundToInt(), placeable.height) {
                            placeable.placeRelative(0, 0)
                        }
                    }
                    .drawWithContent {
                        clipRect(right = size.width * shown()) {
                            this@drawWithContent.drawContent()
                        }
                    },
                style = style,
                maxLines = 1,
                softWrap = false,
            )
        }
        Text(
            text = name,
            modifier = Modifier.graphicsLayer {
                translationX = (shown() - atRest) * wordsWidth
            },
            style = style,
        )
        if (after.isNotEmpty() && showWords) {
            Text(text = after, style = style)
        }
    }
}

/**
 * Lays the title out at its own width while it flies, and as usual otherwise.
 *
 * In flight the shared transition measures the title at the flight's current size: going back to the
 * feed, that starts as narrow as the page's name alone, while the feed's title still lays out all of
 * its words. Squeezed into that, the name wrapped, and all that showed of the title was its "M".
 * The flight's measure is the only one that pins the width to a single value; at rest the parent
 * offers a range, and the name wraps as it should.
 */
private fun Modifier.runOnInFlight(): Modifier = layout { measurable, constraints ->
    val inFlight = constraints.hasFixedWidth
    val placeable = measurable.measure(if (inFlight) constraints.copy(minWidth = 0, maxWidth = Constraints.Infinity) else constraints)
    layout(placeable.width.coerceIn(constraints.minWidth, constraints.maxWidth), placeable.height) {
        placeable.placeRelative(0, 0)
    }
}

/**
 * How much of the words before the name show, 0 to 1. At [atRest] unless [animate]; then while the
 * screen enters or leaves, following it on the flight's own duration and curve, so the name moves
 * with the words exactly as the flight's bounds do. Read where it is drawn, so it only redraws.
 */
@Composable
private fun wordsShown(atRest: Float, animate: Boolean): () -> Float {
    val visibilityScope = LocalNavAnimatedVisibilityScope.current
    if (!animate || visibilityScope == null) {
        return remember(atRest) { { atRest } }
    }
    val shown = visibilityScope.transition.animateFloat(
        transitionSpec = { tween(PAGE_MILLIS, easing = PageEasing) },
        label = "stationTitleWords",
    ) { state -> if (state == EnterExitState.Visible) atRest else 1f - atRest }
    return remember(shown) { { shown.value } }
}
