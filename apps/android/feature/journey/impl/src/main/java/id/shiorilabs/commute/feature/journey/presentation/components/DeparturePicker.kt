package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.ui.ext.Foreground
import id.shiorilabs.commute.core.ui.ext.foreground
import id.shiorilabs.commute.core.ui.theme.Amber700
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate900
import id.shiorilabs.commute.core.ui.theme.TABULAR
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.Blocked
import id.shiorilabs.commute.feature.journey.domain.CHIP_ROW_MAX
import id.shiorilabs.commute.feature.journey.domain.Change
import id.shiorilabs.commute.feature.journey.domain.LegOption
import kotlin.math.roundToInt

/*
 * The trains on one ride leg, to choose between. The web's `departure-picker.tsx`.
 *
 * Up to CHIP_ROW_MAX they are chips in a row, which is what a rider glances along when about to
 * miss one; past that a row scrolls off screen and hides the options, so it becomes a ladder. A
 * train that can no longer be reached after an earlier pick, or that nothing onward connects from,
 * stays in the list but disabled, with which of the two it is.
 */

private fun minutesOf(gapS: Long) = (gapS / 60f).roundToInt()

/** The change between two trains as the rows between rides print it; only a tight one is named. */
@Composable
internal fun ConnectionNote(change: Change, modifier: Modifier = Modifier) {
    val minutes = minutesOf(change.gapS)
    Text(
        text = stringResource(if (change.tight) R.string.journey_change_gap_tight else R.string.journey_change_gap, minutes),
        modifier = modifier,
        style = MaterialTheme.typography.bodySmall.merge(fontFeatureSettings = TABULAR),
        fontWeight = if (change.tight) FontWeight.Bold else FontWeight.Normal,
        color = if (change.tight) Amber700 else Slate500,
    )
}

private class Caption(val text: String, val tight: Boolean)

/** What a departure leads to in as few words as it takes: the verdict only earns its place when something is wrong. */
@Composable
private fun captionOf(option: LegOption): Caption {
    val gap = option.gapToNextS
    return when {
        option.blocked == Blocked.MISSED -> Caption(stringResource(R.string.journey_pick_missed), tight = false)
        option.blocked == Blocked.NO_ONWARD -> Caption(stringResource(R.string.journey_pick_no_onward), tight = false)
        gap == null -> Caption(stringResource(R.string.journey_pick_arrives, formatClock(option.departure.arrivalAt)), tight = false)
        option.tight -> Caption(stringResource(R.string.journey_pick_change_tight, minutesOf(gap)), tight = true)
        else -> Caption(stringResource(R.string.journey_pick_change, minutesOf(gap)), tight = false)
    }
}

/** The line's own colour, filled, for the chosen train; the unchosen are quiet stone plates. */
@Composable
private fun fillOf(option: LegOption, color: Color): Color = if (option.selected) color else Stone100

@Composable
private fun inkOf(option: LegOption, color: Color): Color = when {
    !option.selected -> Slate900
    color.foreground() == Foreground.LIGHT -> Color.White
    else -> Slate900
}

/** The trip page's side margin: the chip row runs out through it to the screen edge, so more chips are seen waiting. */
private val PAGE_MARGIN = 32.dp

/** How far in from the start the chips fade out once the row has been scrolled. */
private val FADE_WIDTH = 28.dp

/**
 * Lets the row run [by] past its parent's end. It reports the parent's own width and only draws the
 * extra, so nothing is coerced or re-centred; the part past the margin is for looking at, as touches
 * out there stop at the parent.
 */
private fun Modifier.bleedEnd(by: Dp): Modifier = layout { measurable, constraints ->
    if (!constraints.hasBoundedWidth) {
        val placeable = measurable.measure(constraints)
        return@layout layout(placeable.width, placeable.height) { placeable.place(0, 0) }
    }
    val width = constraints.maxWidth + by.roundToPx()
    val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
    layout(constraints.maxWidth, placeable.height) { placeable.place(0, 0) }
}

/**
 * Fades the start edge to nothing, by how far the row has scrolled: none at rest, where the first
 * chip sits flush, the whole [FADE_WIDTH] once a chip has gone past it, so a cut chip melts away.
 */
private fun Modifier.fadeStart(state: LazyListState): Modifier = this
    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        val fade = FADE_WIDTH.toPx()
        val scrolled = if (state.firstVisibleItemIndex > 0) fade else state.firstVisibleItemScrollOffset.toFloat()
        val strength = (scrolled / fade).coerceIn(0f, 1f)
        if (strength > 0f) {
            drawRect(
                brush = Brush.horizontalGradient(
                    colors = listOf(Color.Black.copy(alpha = 1f - strength), Color.Black),
                    startX = 0f,
                    endX = fade,
                ),
                size = Size(fade, size.height),
                blendMode = BlendMode.DstIn,
            )
        }
    }

@Composable
internal fun DeparturePicker(
    options: List<LegOption>,
    color: Color,
    onPick: (tripId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (options.size < 2) {
        return
    }
    if (options.size > CHIP_ROW_MAX) {
        Column(modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            options.forEach { option -> LadderRung(option, color, onPick) }
        }
    } else {
        val listState = rememberLazyListState()
        LazyRow(
            state = listState,
            modifier = modifier.bleedEnd(PAGE_MARGIN).fadeStart(listState),
            contentPadding = PaddingValues(end = PAGE_MARGIN),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(options) { option -> Chip(option, color, onPick) }
        }
    }
}

@Composable
private fun Chip(option: LegOption, color: Color, onPick: (String) -> Unit) {
    val caption = captionOf(option)
    val ink = inkOf(option, color)
    val clock = formatClock(option.departure.departureAt)
    Column(
        modifier = optionModifier(option, color, onPick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = clock,
            style = MaterialTheme.typography.titleMedium.merge(fontFeatureSettings = TABULAR),
            fontWeight = FontWeight.Bold,
            color = ink,
            textDecoration = TextDecoration.LineThrough.takeIf { option.blocked != null },
        )
        Text(
            text = caption.text,
            fontSize = 12.sp,
            lineHeight = 14.sp,
            fontWeight = if (caption.tight && !option.selected) FontWeight.Bold else FontWeight.Medium,
            color = captionInk(option, caption, ink),
            maxLines = 1,
        )
    }
}

@Composable
private fun LadderRung(option: LegOption, color: Color, onPick: (String) -> Unit) {
    val caption = captionOf(option)
    val ink = inkOf(option, color)
    Row(
        modifier = optionModifier(option, color, onPick, shape = RoundedCornerShape(0.dp))
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            text = formatClock(option.departure.departureAt),
            modifier = Modifier.width(52.dp),
            style = MaterialTheme.typography.titleMedium.merge(fontFeatureSettings = TABULAR),
            fontWeight = FontWeight.Bold,
            color = ink,
            textDecoration = TextDecoration.LineThrough.takeIf { option.blocked != null },
        )
        Text(
            text = caption.text,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = if (caption.tight && !option.selected) FontWeight.Bold else FontWeight.Normal,
            color = captionInk(option, caption, ink),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun captionInk(option: LegOption, caption: Caption, ink: Color): Color = when {
    option.selected -> ink.copy(alpha = 0.8f)
    caption.tight -> Amber700
    else -> Slate500
}

@Composable
private fun optionModifier(
    option: LegOption,
    color: Color,
    onPick: (String) -> Unit,
    shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(12.dp),
): Modifier {
    val enabled = option.blocked == null
    val description = stringResource(R.string.journey_pick_description, formatClock(option.departure.departureAt))
    return Modifier
        .alpha(if (enabled) 1f else 0.5f)
        .clip(shape)
        .background(fillOf(option, color))
        .semantics(mergeDescendants = true) { selected = option.selected }
        .clickable(enabled = enabled, role = Role.Button, onClickLabel = description) { onPick(option.departure.tripId) }
}
