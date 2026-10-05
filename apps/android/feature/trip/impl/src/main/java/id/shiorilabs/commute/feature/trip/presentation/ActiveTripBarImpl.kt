package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.trip.ActiveTripBar
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Whether the trip page's big name has scrolled up out of sight under the bar. Only the trip page
 * shows the name, so everywhere else the bar acts as if it had.
 */
@Singleton
class TripBarState @Inject constructor() {
    var boardNameHidden by mutableStateOf(false)
}

/**
 * The bar over every screen: on the trip page it is the page's own top, with the close button; on
 * any other it names what's next and opens the trip.
 */
class ActiveTripBarImpl @Inject constructor(
    private val controller: TripControllerImpl,
    private val lines: LineRepository,
    private val barState: TripBarState,
    @param:ApplicationScope scope: CoroutineScope,
) : ActiveTripBar {

    override val visible: StateFlow<Boolean> = controller.active
        .map { it != null }
        .stateIn(scope, SharingStarted.Eagerly, controller.active.value != null)

    @Composable
    override fun Content(topInset: Dp, modifier: Modifier) {
        val trip by controller.active.collectAsStateWithLifecycle()
        val current = trip ?: return
        val navigator = LocalNavigator.current
        val context = LocalContext.current
        var names by remember { mutableStateOf(lines.cachedLines().orEmpty()) }
        LaunchedEffect(Unit) { lines.lines().onRight { names = it } }
        val copy = remember(context, names) { TripCopy(context.resources, names) }
        // The minutes count down between the trip's own updates, as on the board.
        val now by produceState(Instant.now()) {
            while (true) {
                delay(CLOCK_TICK_MILLIS)
                value = Instant.now()
            }
        }
        val onTripPage = navigator.currentKey == Route.ActiveTrip

        PidsBar(
            pids = current.pids(now),
            lines = names,
            copy = copy,
            topInset = topInset,
            collapsed = !onTripPage || barState.boardNameHidden,
            onTripPage = onTripPage,
            onClose = { navigator.pop() },
            onOpen = { navigator.goTo(Route.ActiveTrip) },
            modifier = modifier,
        )
    }
}
