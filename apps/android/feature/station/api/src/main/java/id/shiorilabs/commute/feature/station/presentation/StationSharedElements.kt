package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.SharedTransitionScope.ResizeMode.Companion.scaleToBounds
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.morph.LocalSharedTransitionScope
import id.shiorilabs.commute.core.ui.motion.PAGE_MILLIS
import id.shiorilabs.commute.core.ui.motion.PageEasing

/*
 * What a station's opener shares with its page: its name, its line cards from the home feed and its
 * roundels from a search row fly to where the page has them, and back again on the way out. Where
 * the other side has no such element, these do nothing.
 */

private data class StationNameKey(val stationId: String)

private data class StationTitleKey(val stationId: String)

private data class LineCardKey(val stationId: String, val lineKey: String)

private data class LineRoundelKey(val stationId: String, val lineKey: String)

private val SharedBounds = BoundsTransform { _, _ -> tween(PAGE_MILLIS, easing = PageEasing) }

/**
 * The name flies above the line cards, which sit at 0. At the same height it was drawn under them,
 * so where the two brush past each other, it read as sliding out from beneath the card rather than
 * flying alongside it. Below the home rail (1), which the name lands under like everything else.
 */
private const val NAME_OVERLAY_Z = 0.5f

/**
 * Marks the station's name. Apply it to the name's text alone, sized to its content, on both ends.
 *
 * The same text on both ends ([StationTitleText] on the feed and on the page) flies as one piece,
 * as the line cards do: a single copy moving between the two places, its words revealed as it goes.
 * A search row's name is a different size and highlighted ([scaleText]), so from there the two
 * copies crossfade in flight while the text scales from one size to the other. Each end of a flight
 * passes the same [scaleText], and the two kinds of flight don't share a key.
 *
 * Only one composable on screen may carry it at a time; [enabled] picks the one. The home feed's
 * stuck bar takes it over from the list's hidden copy, and search gives it to the row tapped, when
 * the same station is also among the pinned chips or the recents.
 */
@Composable
fun Modifier.sharedStationName(stationId: String, enabled: Boolean = true, scaleText: Boolean = true): Modifier {
    if (!enabled) {
        return this
    }
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this

    return with(sharedScope) {
        if (scaleText) {
            this@sharedStationName.sharedBounds(
                sharedContentState = rememberSharedContentState(StationNameKey(stationId)),
                animatedVisibilityScope = visibilityScope,
                enter = fadeIn(tween(PAGE_MILLIS, easing = PageEasing)),
                exit = fadeOut(tween(PAGE_MILLIS, easing = PageEasing)),
                boundsTransform = SharedBounds,
                resizeMode = scaleToBounds(ContentScale.Fit, Alignment.CenterStart),
                zIndexInOverlay = NAME_OVERLAY_Z,
            )
        } else {
            this@sharedStationName.sharedElement(
                sharedContentState = rememberSharedContentState(StationTitleKey(stationId)),
                animatedVisibilityScope = visibilityScope,
                boundsTransform = SharedBounds,
                zIndexInOverlay = NAME_OVERLAY_Z,
            )
        }
    }
}

/**
 * Marks one of the station's line cards. The same card on both ends, at the same width.
 *
 * [joinAfterFirstFrame] is for the station page's end: its cards join the flight from the page's
 * second composition rather than its first. The frame a page opens on is a long one (about 80 ms;
 * it builds the whole page), and a card already flying through it showed up next almost landed,
 * while the title, which Compose only lets fly from the second, made the whole trip: the cards
 * seemed to snap into place and the title to trail them. The page isn't showing yet in that frame,
 * so nothing is seen of the card sitting it out.
 */
@Composable
fun Modifier.sharedLineCard(stationId: String, lineKey: String, joinAfterFirstFrame: Boolean = false): Modifier {
    var joined by remember { mutableStateOf(!joinAfterFirstFrame) }
    // Set once the first composition is applied, so the card is in the very next one: the one the
    // title joins on. Waiting for a frame instead put the cards a frame behind the title.
    SideEffect { joined = true }
    return sharedElement(LineCardKey(stationId, lineKey), enabled = joined)
}

/** Marks one of the station's roundels, [lineKey] being `OPERATOR:CODE`. The same size on both ends. */
@Composable
fun Modifier.sharedLineRoundel(stationId: String, lineKey: String, enabled: Boolean = true): Modifier =
    sharedElement(LineRoundelKey(stationId, lineKey), enabled)

@Composable
private fun Modifier.sharedElement(key: Any, enabled: Boolean): Modifier {
    if (!enabled) {
        return this
    }
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this

    return with(sharedScope) {
        this@sharedElement.sharedElement(
            sharedContentState = rememberSharedContentState(key),
            animatedVisibilityScope = visibilityScope,
            boundsTransform = SharedBounds,
        )
    }
}
