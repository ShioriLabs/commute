package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.journey.domain.JAKARTA
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
        val navigator = LocalNavigator.current

        LifecycleResumeEffect(viewModel) {
            viewModel.onResume()
            onPauseOrDispose { }
        }

        FarePanel(
            state = state,
            picker = picker,
            now = rememberJakartaNow().atZone(JAKARTA).toInstant(),
            actions = viewModel.panelActions(),
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .padding(contentPadding),
            footer = {
                OpenFarePageLink(onClick = { navigator.goTo(Route.Journey(fromId = state.pair.fromId, toId = state.pair.toId)) })
            },
        )
    }
}
