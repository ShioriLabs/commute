package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.journey.domain.JAKARTA
import id.shiorilabs.commute.feature.journey.presentation.components.RecentRoutes
import id.shiorilabs.commute.feature.journey.presentation.components.SaveRouteSquare
import javax.inject.Inject

/** Keys the tab's ViewModel apart from any other on the search screen's entry. */
private const val OTW_PANEL_KEY = "otw-panel"

/**
 * Search's OTW tab. Its ViewModel lives as long as the search screen, so switching tabs and back
 * keeps the pair; "Buka halaman tarif" opens the same pair as a page of its own.
 */
class OtwPanelImpl @Inject constructor() : OtwPanel {

    @Composable
    override fun Content(contentPadding: PaddingValues, modifier: Modifier) {
        val viewModel = hiltViewModel<JourneyViewModel, JourneyViewModel.Factory>(
            key = OTW_PANEL_KEY,
            creationCallback = { factory -> factory.create(Route.Journey()) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        val picker by viewModel.picker.collectAsStateWithLifecycle()
    val pickerText by viewModel.pickerText.collectAsStateWithLifecycle()
        val routeSaved by viewModel.routeSaved.collectAsStateWithLifecycle()
        val recentRoutes by viewModel.recentRoutes.collectAsStateWithLifecycle()
        val navigator = LocalNavigator.current

        LifecycleResumeEffect(viewModel) {
            viewModel.onResume()
            onPauseOrDispose { }
        }

        Column(
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .padding(contentPadding),
        ) {
            FarePanel(
                state = state,
                picker = picker,
                pickerText = pickerText,
                now = rememberJakartaNow().atZone(JAKARTA).toInstant(),
                actions = viewModel.panelActions(),
                footer = {
                    Row(
                        modifier = Modifier
                            .padding(top = 16.dp)
                            .height(IntrinsicSize.Min),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OpenFarePageLink(
                            onClick = { navigator.goTo(Route.Journey(fromId = state.pair.fromId, toId = state.pair.toId)) },
                            modifier = Modifier.weight(1f),
                        )
                        routeSaved?.let { saved ->
                            SaveRouteSquare(saved = saved, onClick = viewModel::onToggleSaveRoute)
                        }
                    }
                },
            )
            if (state.pair.fromId == null || state.pair.toId == null) {
                RecentRoutes(
                    routes = recentRoutes,
                    onOpen = { route -> navigator.goTo(Route.Journey(fromId = route.fromId, toId = route.toId)) },
                    onTogglePin = viewModel::onToggleRecentRoute,
                    onClear = viewModel::onClearRecentRoutes,
                    modifier = Modifier.padding(top = 24.dp),
                )
            }
        }
    }
}
