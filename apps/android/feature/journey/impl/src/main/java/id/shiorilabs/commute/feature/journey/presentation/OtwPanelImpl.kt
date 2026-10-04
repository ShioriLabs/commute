package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import id.shiorilabs.commute.feature.journey.presentation.components.SaveRoutePlate
import id.shiorilabs.commute.feature.journey.presentation.trip.tripRoute
import javax.inject.Inject

/** Keys the tab's ViewModel apart from any other on the search screen's entry. */
private const val OTW_PANEL_KEY = "otw-panel"

/**
 * Search's OTW tab. Its ViewModel lives as long as the search screen, so switching tabs and back
 * keeps the pair, as does a trip page opened from one of its options.
 */
class OtwPanelImpl @Inject constructor() : OtwPanel {

    @Composable
    override fun Content(seed: Route.Otw?, contentPadding: PaddingValues, modifier: Modifier) {
        val viewModel = hiltViewModel<JourneyViewModel, JourneyViewModel.Factory>(
            key = OTW_PANEL_KEY,
            creationCallback = { factory -> factory.create(seed ?: Route.Otw()) },
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
                actions = viewModel.panelActions(
                    onSelectJourney = { journey ->
                        val fromId = state.pair.fromId
                        val toId = state.pair.toId
                        if (fromId != null && toId != null) {
                            navigator.goTo(tripRoute(fromId, toId, journey, state.criteria))
                        }
                    },
                ),
                footer = {
                    routeSaved?.let { saved ->
                        SaveRoutePlate(
                            saved = saved,
                            onClick = viewModel::onToggleSaveRoute,
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                },
            )
            if (state.pair.fromId == null || state.pair.toId == null) {
                RecentRoutes(
                    routes = recentRoutes,
                    onOpen = viewModel::onOpenRecent,
                    onTogglePin = viewModel::onToggleRecentRoute,
                    onClear = viewModel::onClearRecentRoutes,
                    modifier = Modifier.padding(top = 24.dp),
                )
            }
        }
    }
}
