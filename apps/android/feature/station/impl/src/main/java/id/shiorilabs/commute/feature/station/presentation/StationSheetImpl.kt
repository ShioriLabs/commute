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

/**
 * The station page in the map's sheet: the same content, with the close and the transfers handed
 * to the map, and a button out to the full page. What the map doesn't handle (the timetable, a
 * line's page, the maps app) opens as it does from the page.
 */
class StationSheetImpl @Inject constructor() : StationSheet {

    @Composable
    override fun Content(
        stationId: String,
        onClose: () -> Unit,
        onOpenPage: () -> Unit,
        onOpenStation: (stationId: String) -> Unit,
        onOtw: () -> Unit,
        modifier: Modifier,
    ) {
        // One per station shown, in the map's own store: switching stations keeps each one's board.
        val viewModel = hiltViewModel<StationViewModel, StationViewModel.Factory>(
            key = "map-sheet:$stationId",
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
                innerPadding = PaddingValues(),
                onToggleSave = viewModel::onToggleSave,
                onClose = onClose,
                onOpenPage = onOpenPage,
                onRetry = viewModel::retry,
                onOpenMaps = { station -> mapsUrl(station)?.let(uriHandler::openUri) },
                onOtw = onOtw,
                onOpenTimetable = { title -> navigator.goTo(Route.StationTimetable(stationId, title)) },
                onOpenStation = onOpenStation,
                onOpenAttributions = { navigator.goTo(Route.SettingsDataAttributions) },
                onOpenLine = { key -> lineRoute(key, state.lines)?.let(navigator::goTo) },
            )
        }
    }
}
