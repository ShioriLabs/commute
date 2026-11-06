package id.shiorilabs.commute.feature.hub.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import javax.inject.Inject

/** The hub page in the map's sheet: the same content, its close and its members handed to the map. */
class HubSheetImpl @Inject constructor() : HubSheet {

    @Composable
    override fun Content(
        slug: String,
        onClose: () -> Unit,
        onOpenPage: () -> Unit,
        onOpenStation: (stationId: String) -> Unit,
        modifier: Modifier,
    ) {
        val viewModel = hiltViewModel<HubViewModel, HubViewModel.Factory>(
            key = "map-sheet:$slug",
            creationCallback = { factory -> factory.create(slug) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        val offline by rememberIsOffline()

        Box(modifier) {
            HubContent(
                state = state,
                slug = slug,
                innerPadding = PaddingValues(),
                offline = offline,
                onClose = onClose,
                onRetry = viewModel::retry,
                onOpenStation = { member -> onOpenStation(member.id) },
                onOpenPage = onOpenPage,
            )
        }
    }
}
