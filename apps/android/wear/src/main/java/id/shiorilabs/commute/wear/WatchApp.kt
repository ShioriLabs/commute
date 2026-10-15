package id.shiorilabs.commute.wear

import android.widget.Toast
import androidx.annotation.DrawableRes
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.painterResource
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnLayoutInfo
import androidx.wear.compose.material3.Icon
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OpenOnPhoneDialog
import androidx.wear.compose.material3.OpenOnPhoneDialogDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeTextDefaults
import androidx.wear.compose.material3.openOnPhoneDialogCurvedText
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.headline
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.wearable.WearTrip
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/** Before the Data Layer has answered: nothing is drawn, so "no trip" doesn't flash past a trip. */
private object Loading

@Composable
fun WatchApp(trips: Flow<WearTrip?>, phone: PhoneLink) {
    val loaded = remember(trips) { trips.map { it ?: NoTrip } }
    val current by loaded.collectAsStateWithLifecycle(initialValue = Loading)
    val now by rememberNow()
    // The arrived trip the rider tapped away, by when it arrived.
    var dismissedArrival by rememberSaveable { mutableStateOf<Long?>(null) }

    CommuteWatchTheme {
        AppScaffold {
            when (val trip = current) {
                is WearTrip -> {
                    val arrivedAt = trip.state.arrivedAt
                    when {
                        trip.finished == null -> TripScreen(trip, now, phone)
                        arrivedAt != null && arrivedAt.toEpochMilli() != dismissedArrival &&
                            now.isBefore(arrivedAt.plus(ARRIVED_SHOWN)) ->
                            ArrivedScreen(trip) { dismissedArrival = arrivedAt.toEpochMilli() }
                        else -> IdleScreen(phone)
                    }
                }
                NoTrip -> IdleScreen(phone)
                else -> Unit
            }
        }
    }
}

private object NoTrip

@Composable
private fun IdleScreen(phone: PhoneLink) {
    val scope = rememberCoroutineScope()
    // Centred, as a few lines on a round face should be: the trip screen's list starts at the top.
    val listState = rememberScalingLazyListState()
    var opening by remember { mutableStateOf(false) }
    val openOnPhone = stringResource(R.string.idle_open_phone)

    ScreenScaffold(
        scrollState = listState,
        edgeButton = {
            EdgeButton(onClick = {
                opening = true
                scope.launch { phone.openApp() }
            }) { Text(openOnPhone) }
        },
    ) { padding ->
        ScalingLazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
            item {
                Text(
                    stringResource(R.string.idle_title),
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = IDLE_INSET),
                )
            }
            item {
                Text(
                    stringResource(R.string.idle_detail),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = IDLE_INSET),
                )
            }
        }
    }

    val style = OpenOnPhoneDialogDefaults.curvedTextStyle
    val text = OpenOnPhoneDialogDefaults.text
    OpenOnPhoneDialog(
        visible = opening,
        onDismissRequest = { opening = false },
        curvedText = { openOnPhoneDialogCurvedText(text = text, style = style) },
    )
}

@Composable
private fun TripScreen(trip: WearTrip, now: Instant, phone: PhoneLink) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val listState = rememberTransformingLazyColumnState()
    val copy = remember(resources, trip.lines) { WatchCopy(resources, trip.lines) }
    val headline = trip.state.headline(trip.plan)
    val progress = trip.state.progress(trip.plan)
    val ride = trip.plan.ride(trip.state.legIndex)
    var confirmingStop by remember { mutableStateOf(false) }
    val failed = stringResource(R.string.trip_send_failed)

    fun send(action: RiderAction) {
        scope.launch {
            if (!phone.send(action)) Toast.makeText(context, failed, Toast.LENGTH_SHORT).show()
        }
    }

    val primary = primaryAction(trip, headline)
    val hero = tripHero(headline, trip.state.source, now)
    val lineColor = trip.lines[ride.line]?.color?.let(::Color) ?: MaterialTheme.colorScheme.primary
    // How far the top has scrolled off: the arc thins away and the tint fades to black with it.
    val scrolledAway by remember(listState) { derivedStateOf { scrolledAway(listState.layoutInfo) } }
    // The tap the moment calls for sits under the top, not in an edge button: one of those only
    // grows in at the end of the list, and this list runs past the screen.
    // No clock round the top: the top of the trip says the time itself, as Health's "Now".
    ScreenScaffold(scrollState = listState, timeText = {}) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .drawBehind { drawRect(lineTint(lineColor), alpha = 1f - scrolledAway) },
        ) {
            TripArc(
                rideFractions = progress.rideFractions,
                fraction = progress.fraction,
                colors = trip.plan.rideIndices.map { index ->
                    trip.lines[trip.plan.ride(index).line]?.color?.let(::Color) ?: MaterialTheme.colorScheme.primary
                },
                thickness = ARC_THICKNESS * (1f - scrolledAway),
                modifier = Modifier.fillMaxSize(),
            )
            TransformingLazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
                item {
                    TripTop(
                        icon = if (headline is Headline.Board || headline is Headline.Change) {
                            CopyR.drawable.ic_stat_boarding
                        } else {
                            CopyR.drawable.ic_stat_alight
                        },
                        figure = copy.heroFigure(hero),
                        unit = copy.heroUnit(hero),
                        lead = copy.lead(headline),
                        place = copy.place(headline),
                        detail = copy.heroDetail(headline, hero),
                    )
                }
                if (trip.state.askedStillOnRoute) {
                    item {
                        Text(
                            stringResource(R.string.trip_ask_still_on_route),
                            style = MaterialTheme.typography.bodySmall,
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier.padding(horizontal = TEXT_INSET),
                        )
                    }
                }
                if (primary != null) {
                    item {
                        // As wide as its word: a full-width button runs into the round edge down here.
                        Button(onClick = { send(primary.action) }) {
                            Text(stringResource(primary.label))
                        }
                    }
                }
                copy.source(trip.state)?.let { source ->
                    item {
                        Text(
                            source,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                // Rarely what's wanted, so small and last.
                item {
                    CompactButton(
                        onClick = { confirmingStop = true },
                        colors = ButtonDefaults.filledTonalButtonColors(),
                    ) {
                        Text(stringResource(CopyR.string.trip_action_stop))
                    }
                }
            }
        }
    }

    AlertDialog(
        visible = confirmingStop,
        onDismissRequest = { confirmingStop = false },
        title = { Text(stringResource(R.string.trip_stop_confirm)) },
        confirmButton = {
            AlertDialogDefaults.ConfirmButton(onClick = {
                confirmingStop = false
                send(RiderAction.STOP)
            })
        },
    )
}

@Composable
private fun ArrivedScreen(trip: WearTrip, onDismiss: () -> Unit) {
    val resources = LocalResources.current
    val copy = remember(resources, trip.lines) { WatchCopy(resources, trip.lines) }
    ScreenScaffold {
        Box(
            Modifier.fillMaxSize().clickable(onClick = onDismiss).padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                copy.title(Headline.Arrived(trip.plan.destination.name)),
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The top of the trip, led by one big figure as Health leads with the heart rate: the time, getting
 * on or off, the figure and what it counts, then where. With no figure ([figure] `null`) the
 * place is said big instead. Whole names wrap or shrink rather than cut: a sponsor's name is the
 * station's name.
 */
@Composable
private fun TripTop(
    @DrawableRes icon: Int,
    figure: String?,
    unit: String?,
    lead: String,
    place: String,
    detail: String,
) {
    val colors = MaterialTheme.colorScheme
    val type = MaterialTheme.typography
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth().padding(horizontal = TEXT_INSET),
    ) {
        Text(
            TimeTextDefaults.rememberTimeSource(TimeTextDefaults.timeFormat()).currentTime(),
            style = type.titleMedium,
            color = colors.onSurface,
        )
        Icon(
            painterResource(icon),
            contentDescription = null,
            tint = colors.onSurface,
            modifier = Modifier.padding(top = 4.dp).size(ICON_SIZE),
        )
        if (figure != null) {
            // The unit beside the figure, as Health's "109–120 bpm": under it, the top ran into
            // the narrow bottom of the round screen and cut the place's name off at the sides.
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 2.dp)) {
                BasicText(
                    figure,
                    style = type.numeralExtraLarge.copy(
                        color = colors.onSurface,
                        fontWeight = FontWeight.SemiBold,
                        lineHeight = 1.em,
                        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both),
                    ),
                    maxLines = 1,
                    autoSize = TextAutoSize.StepBased(minFontSize = type.numeralSmall.fontSize, maxFontSize = type.numeralExtraLarge.fontSize),
                    modifier = Modifier.alignByBaseline(),
                )
                if (unit != null) {
                    Text(
                        unit,
                        style = type.titleMedium,
                        color = colors.onSurface,
                        modifier = Modifier.alignByBaseline().padding(start = 6.dp),
                    )
                }
            }
            Text(
                lead,
                style = type.labelMedium,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                place,
                style = type.titleMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
        } else {
            Text(
                lead,
                style = type.labelMedium,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            BasicText(
                place,
                style = type.displayMedium.copy(color = colors.onSurface, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                maxLines = 2,
                autoSize = TextAutoSize.StepBased(minFontSize = type.titleLarge.fontSize, maxFontSize = type.displayMedium.fontSize),
            )
        }
        if (detail.isNotEmpty()) {
            Text(
                detail,
                style = type.bodySmall,
                color = colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/**
 * How far the top item has scrolled off, 0 at rest to 1 once half of it has gone; 1 too once it's
 * out of sight altogether.
 */
private fun scrolledAway(info: TransformingLazyColumnLayoutInfo): Float {
    val top = info.visibleItems.firstOrNull { it.index == 0 } ?: return 1f
    if (top.measuredHeight == 0) return 0f
    val scrolled = info.beforeContentPadding - top.offset
    return (scrolled / (top.measuredHeight * SCROLLED_AWAY_SHARE)).coerceIn(0f, 1f)
}

/** The line's colour, deep, rising from the bottom of the black: Health's maroon, in the line's own. */
private fun lineTint(line: Color): Brush = Brush.verticalGradient(
    listOf(lerp(Color.Black, line, TINT_TOP), lerp(Color.Black, line, TINT_BOTTOM)),
)

private class PrimaryAction(val action: RiderAction, val label: Int)

/** The one tap the moment calls for, as the phone's Live Update offers it. */
private fun primaryAction(trip: WearTrip, headline: Headline): PrimaryAction? = when {
    trip.state.askedStillOnRoute -> PrimaryAction(RiderAction.STILL_ON_ROUTE, CopyR.string.trip_action_still_on_route)
    headline is Headline.AlightNow || (headline is Headline.RideTo && headline.stopsLeft <= 1) ->
        PrimaryAction(RiderAction.ALIGHTED, CopyR.string.trip_action_alighted)
    trip.state.phase == TripPhase.WAITING_TO_BOARD -> PrimaryAction(RiderAction.BOARDED, CopyR.string.trip_action_boarded)
    else -> null
}

/** The watch's own clock, a few times a minute: minutes count down without waiting on the phone. */
@Composable
private fun rememberNow() = produceState(Instant.now()) {
    while (true) {
        delay(TICK_MS)
        value = Instant.now()
    }
}

private const val TICK_MS = 15_000L

/** How long "udah sampai" stays up after the trip arrives. */
private val ARRIVED_SHOWN: Duration = Duration.ofMinutes(5)

/** Keeps the idle screen's lines clear of the round edge. */
private val IDLE_INSET = 12.dp

/** Keeps the trip's text clear of the arc round the edge. */
private val TEXT_INSET = 16.dp

/** The arc at rest, as thick as Health's. */
private val ARC_THICKNESS = 14.dp

private val ICON_SIZE = 22.dp

/** How much of the top scrolls off before the arc and the tint are gone. */
private const val SCROLLED_AWAY_SHARE = 0.5f

/** How much of the line's colour is in the black, at the top and the bottom of the screen. */
private const val TINT_TOP = 0.06f
private const val TINT_BOTTOM = 0.3f
