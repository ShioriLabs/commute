package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.DEPARTURE_HOURS
import id.shiorilabs.commute.feature.journey.domain.DEPARTURE_MINUTES
import id.shiorilabs.commute.feature.journey.domain.DEPARTURE_SLOT_MINUTES
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JAKARTA
import id.shiorilabs.commute.feature.journey.domain.composeDeparture
import id.shiorilabs.commute.feature.journey.domain.departureDays
import id.shiorilabs.commute.feature.journey.domain.formatDepartureDay
import id.shiorilabs.commute.feature.journey.domain.quantiseToSlot
import id.shiorilabs.commute.feature.journey.domain.shiftBySlot
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.time.Instant

private val RowHeight = 44.dp

/** Rows above and below the selection, so the first and last can reach the centre. */
private const val PADDING_ROWS = 2

/** `bg-stone-100/80`, the band behind the selected row. */
private val SelectionBand = Color(0xCCF5F5F4)

/**
 * When the rider is leaving: a day, an hour and a minute on wheels, the minutes on the 20-minute grid
 * the API answers on, so the wheel never shows a time it would floor. Nudges a slot either way,
 * goes back to now, or sets the picked time. The web's `DepartureSheet`.
 */
@Composable
internal fun DepartureSheet(departure: Departure, onSelect: (Departure) -> Unit, onDismiss: () -> Unit) {
    val now = remember { Instant.now() }
    val days = remember(now) { departureDays(now) }
    var draft by remember {
        mutableStateOf(
            when (departure) {
                Departure.Now -> quantiseToSlot(now)
                is Departure.At -> quantiseToSlot(departure.instant)
            },
        )
    }
    val local = draft.atZone(JAKARTA)
    val title = stringResource(R.string.journey_departure_title)
    val haptics = LocalHapticFeedback.current
    val nudge = { slots: Int ->
        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
        draft = shiftBySlot(Departure.At(draft), slots, Instant.now())
    }

    CommuteBottomSheet(
        title = title,
        closeDescription = stringResource(R.string.journey_sheet_close, title.lowercase()),
        onDismiss = onDismiss,
    ) { hide ->
        Column(modifier = Modifier.padding(horizontal = 32.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(RowHeight)
                        .clip(MaterialTheme.shapes.medium)
                        .background(SelectionBand),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WheelColumn(
                        items = days,
                        selected = days.indexOf(local.toLocalDate()).coerceAtLeast(0),
                        onSettle = { draft = composeDeparture(days[it], local.hour, local.minute) },
                        label = stringResource(R.string.journey_departure_day),
                        modifier = Modifier.weight(1f),
                    ) { day -> formatDepartureDay(day, now) }
                    WheelColumn(
                        items = DEPARTURE_HOURS,
                        selected = local.hour,
                        onSettle = { draft = composeDeparture(local.toLocalDate(), DEPARTURE_HOURS[it], local.minute) },
                        label = stringResource(R.string.journey_departure_hour),
                        modifier = Modifier.width(64.dp),
                    ) { hour -> hour.toString().padStart(2, '0') }
                    WheelColumn(
                        items = DEPARTURE_MINUTES,
                        selected = DEPARTURE_MINUTES.indexOf(local.minute).coerceAtLeast(0),
                        onSettle = { draft = composeDeparture(local.toLocalDate(), local.hour, DEPARTURE_MINUTES[it]) },
                        label = stringResource(R.string.journey_departure_minute),
                        modifier = Modifier.width(64.dp),
                    ) { minute -> minute.toString().padStart(2, '0') }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                NudgeButton(
                    text = stringResource(R.string.journey_departure_earlier, DEPARTURE_SLOT_MINUTES),
                    leading = true,
                    onClick = { nudge(-1) },
                )
                Text(
                    text = stringResource(R.string.journey_departure_now),
                    modifier = Modifier
                        .clip(MaterialTheme.shapes.small)
                        .clickable(role = Role.Button) {
                            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                            onSelect(Departure.Now)
                            hide()
                        }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
                NudgeButton(
                    text = stringResource(R.string.journey_departure_later, DEPARTURE_SLOT_MINUTES),
                    leading = false,
                    onClick = { nudge(1) },
                )
            }

            Text(
                text = stringResource(R.string.journey_departure_set),
                modifier = Modifier
                    .padding(top = 16.dp, bottom = 32.dp)
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(MaterialTheme.colorScheme.primary)
                    .clickable(role = Role.Button) {
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        onSelect(Departure.At(draft))
                        hide()
                    }
                    .padding(vertical = 14.dp),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun NudgeButton(text: String, leading: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(MaterialTheme.shapes.small)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading) {
            Icon(imageVector = CommuteIcons.Back, contentDescription = null, modifier = Modifier.size(14.dp), tint = Slate500)
        }
        Text(text = text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Slate500)
        if (!leading) {
            Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(14.dp), tint = Slate500)
        }
    }
}

/**
 * One wheel: a list that snaps a row into the band at its centre. Scrolling settles on a row;
 * tapping one picks it. [selected] drives it from outside, so a nudge turns the wheels too.
 */
@Composable
private fun <T> WheelColumn(
    items: List<T>,
    selected: Int,
    onSettle: (Int) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    render: (T) -> String,
) {
    val state = rememberLazyListState(initialFirstVisibleItemIndex = selected)
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    // Read where the wheel comes to rest, long after this composition: the selection by then is
    // whatever the last settle, a nudge or another wheel made it.
    val currentSelected by rememberUpdatedState(selected)
    val currentOnSettle by rememberUpdatedState(onSettle)

    // Follow the selection when it moves from outside the wheel: a nudge, or another wheel.
    LaunchedEffect(selected) {
        if (!state.isScrollInProgress && state.firstVisibleItemIndex != selected) {
            state.animateScrollToItem(selected)
        }
    }
    // Report where a fling or drag came to rest.
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }
            .distinctUntilChanged()
            .filter { scrolling -> !scrolling }
            .collect {
                val settled = state.firstVisibleItemIndex.coerceIn(0, items.lastIndex)
                if (settled != currentSelected) {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
                    currentOnSettle(settled)
                }
            }
    }

    LazyColumn(
        state = state,
        modifier = modifier
            .height(RowHeight * (PADDING_ROWS * 2 + 1))
            .semantics { contentDescription = label },
        contentPadding = PaddingValues(vertical = RowHeight * PADDING_ROWS),
        flingBehavior = rememberSnapFlingBehavior(state),
    ) {
        itemsIndexed(items) { index, item ->
            val isSelected = index == selected
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(RowHeight)
                    .clickable(role = Role.Button) {
                        onSettle(index)
                        scope.launch { state.animateScrollToItem(index) }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = render(item),
                    modifier = Modifier
                        .padding(horizontal = 8.dp)
                        .scale(if (isSelected) 1f else 0.95f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    color = if (isSelected) Slate900 else Slate400,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
