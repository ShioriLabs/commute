package id.shiorilabs.commute.feature.hub.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import id.shiorilabs.commute.feature.station.presentation.StationBody
import javax.inject.Inject

/** The hub page in the map's sheet: the same content, its close and its members handed to the map. */
class HubSheetImpl @Inject constructor(
    private val stationBody: StationBody,
) : HubSheet {

    @Composable
    override fun Content(
        slug: String,
        initialMemberId: String?,
        onClose: () -> Unit,
        onOpenPage: (memberId: String?) -> Unit,
        onOpenStation: (stationId: String) -> Unit,
        onOtw: (stationId: String) -> Unit,
        onIsolateLine: (lineKey: String) -> Boolean,
        modifier: Modifier,
    ) {
        val viewModel = hiltViewModel<HubViewModel, HubViewModel.Factory>(
            key = "map-sheet:$slug",
            creationCallback = { factory -> factory.create(slug) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        val offline by rememberIsOffline()
        // The side showing, so the full page opens on it.
        var showing by remember(slug, initialMemberId) { mutableStateOf(initialMemberId) }

        Box(modifier) {
            HubContent(
                state = state,
                slug = slug,
                innerPadding = PaddingValues(),
                offline = offline,
                initialMemberId = initialMemberId,
                stationBody = stationBody,
                onClose = onClose,
                onRetry = viewModel::retry,
                onOpenStation = { member -> onOpenStation(member.id) },
                onOpenStationId = onOpenStation,
                onOtw = onOtw,
                onIsolateLine = onIsolateLine,
                onSelectMember = { member -> showing = member.id },
                onOpenPage = { onOpenPage(showing) },
            )
        }
    }
}
