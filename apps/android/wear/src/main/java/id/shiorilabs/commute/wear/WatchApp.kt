package id.shiorilabs.commute.wear

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
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
import androidx.wear.compose.material3.openOnPhoneDialogCurvedText
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.headline
import id.shiorilabs.commute.core.trip.progress
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
    // The tap the moment calls for sits under the headline, not in an edge button: one of those
    // only grows in at the end of the list, and this list runs past the screen.
    ScreenScaffold(scrollState = listState) { padding ->
        Box(Modifier.fillMaxSize()) {
            TripRing(
                rideFractions = progress.rideFractions,
                fraction = progress.fraction,
                colors = trip.plan.rideIndices.map { index ->
                    trip.lines[trip.plan.ride(index).line]?.color?.let(::Color) ?: MaterialTheme.colorScheme.primary
                },
                modifier = Modifier.fillMaxSize(),
            )
            TransformingLazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
                item {
                    LineRow(
                        code = ride.line.substringAfter(':'),
                        name = copy.rideLabel(headline, ride),
                        color = trip.lines[ride.line]?.color?.let(::Color),
                        operator = ride.operator,
                    )
                }
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = TEXT_INSET)) {
                        Text(
                            copy.lead(headline),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            copy.place(headline),
                            style = MaterialTheme.typography.titleLarge,
                            textAlign = TextAlign.Center,
                            // One line, cut short: a sponsor's name ("Dukuh Atas Bank Syariah
                            // Indonesia") wrapped to two and pushed the button off the screen.
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                val minutes = copy.minutes(trip.state, headline, now)
                val detail = copy.detail(trip.state, headline, now)
                if (minutes != null || detail.isNotEmpty()) {
                    item {
                        val accent = MaterialTheme.colorScheme.primary
                        Text(
                            buildAnnotatedString {
                                if (minutes != null) {
                                    withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append(minutes) }
                                    if (detail.isNotEmpty()) append(WatchCopy.SEPARATOR)
                                }
                                append(detail)
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = TEXT_INSET),
                        )
                    }
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
                        Text(stringResource(R.string.trip_action_stop))
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
 * The ride's line: its roundel, then its name, as the phone heads a ride. Inset, as it sits up where
 * the round screen is narrow: without it a long "arah …" ran off under the bezel, roundel and all.
 */
@Composable
private fun LineRow(code: String, name: String, color: Color?, operator: String) {
    Row(
        modifier = Modifier.padding(horizontal = HEADER_INSET),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Roundel(code, color ?: MaterialTheme.colorScheme.outline, operator)
        Text(
            name,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private class PrimaryAction(val action: RiderAction, val label: Int)

/** The one tap the moment calls for, as the phone's Live Update offers it. */
private fun primaryAction(trip: WearTrip, headline: Headline): PrimaryAction? = when {
    trip.state.askedStillOnRoute -> PrimaryAction(RiderAction.STILL_ON_ROUTE, R.string.trip_action_still_on_route)
    headline is Headline.AlightNow || (headline is Headline.RideTo && headline.stopsLeft <= 1) ->
        PrimaryAction(RiderAction.ALIGHTED, R.string.trip_action_alighted)
    trip.state.phase == TripPhase.WAITING_TO_BOARD -> PrimaryAction(RiderAction.BOARDED, R.string.trip_action_boarded)
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

/** Keeps the trip's text clear of the ring round the edge. */
private val TEXT_INSET = 8.dp

/** Keeps the line row, near the top where the circle narrows, inside it. */
private val HEADER_INSET = 28.dp
