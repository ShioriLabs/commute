package id.shiorilabs.commute.feature.station.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import id.shiorilabs.commute.core.ui.time.rememberTimetableNow
import javax.inject.Inject

/** The station page under a hub's header: the same content, a [header] in place of the station's own. */
class StationBodyImpl @Inject constructor() : StationBody {

    @Composable
    override fun Content(
        stationId: String,
        header: @Composable () -> Unit,
        innerPadding: PaddingValues,
        onOpenStation: (stationId: String) -> Unit,
        onOtw: () -> Unit,
        onIsolateLine: (lineKey: String) -> Boolean,
        modifier: Modifier,
    ) {
        // One per member shown, keyed apart from the station's own page and the map's sheet.
        val viewModel = hiltViewModel<StationViewModel, StationViewModel.Factory>(
            key = "hub-body:$stationId",
            creationCallback = { factory -> factory.create(stationId) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        val navigator = LocalNavigator.current
        val uriHandler = LocalUriHandler.current
        val now = rememberTimetableNow()
        val offline by rememberIsOffline()
        LaunchedEffect(now) {
            viewModel.onClockTick(now)
        }

        Box(modifier) {
            StationContent(
                state = state,
                now = now,
                offline = offline,
                innerPadding = innerPadding,
                header = header,
                onRetry = viewModel::retry,
                onOpenMaps = { station -> mapsUrl(station)?.let(uriHandler::openUri) },
                onOtw = onOtw,
                onOpenTimetable = { title -> navigator.goTo(Route.StationTimetable(stationId, title)) },
                onOpenStation = onOpenStation,
                onOpenAttributions = { navigator.goTo(Route.SettingsDataAttributions) },
                onOpenLine = { key -> lineRoute(key, state.lines)?.let(navigator::goTo) },
                onOpenLineCard = { key ->
                    if (!onIsolateLine(key)) lineRoute(key, state.lines)?.let(navigator::goTo)
                },
            )
        }
    }
}
