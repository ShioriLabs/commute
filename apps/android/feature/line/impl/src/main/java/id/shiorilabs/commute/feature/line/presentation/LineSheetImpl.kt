package id.shiorilabs.commute.feature.line.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import javax.inject.Inject

/** The line page in the map's sheet: the same content, its close, stops and badges handed to the map. */
class LineSheetImpl @Inject constructor() : LineSheet {

    @Composable
    override fun Content(
        operator: String,
        lineCode: String,
        title: String,
        colorCode: String,
        onClose: () -> Unit,
        onBack: (() -> Unit)?,
        onOpenPage: (() -> Unit)?,
        onOpenStation: (stationId: String) -> Unit,
        onOpenLine: (lineKey: String) -> Unit,
        modifier: Modifier,
    ) {
        // One per line shown, in the map's own store: switching lines keeps each one's branch.
        val viewModel = hiltViewModel<LineViewModel, LineViewModel.Factory>(
            key = "map-sheet:$operator:$lineCode",
            creationCallback = { factory -> factory.create(operator, lineCode) },
        )
        val state by viewModel.state.collectAsStateWithLifecycle()
        val offline by rememberIsOffline()

        Box(modifier) {
            LineContent(
                state = state,
                operator = operator,
                lineCode = lineCode,
                innerPadding = PaddingValues(),
                offline = offline,
                placeholderTitle = title,
                placeholderColor = colorCode,
                onClose = onClose,
                onBack = onBack,
                onOpenPage = onOpenPage,
                onRetry = viewModel::retry,
                onShowBranch = viewModel::onShowBranch,
                onOpenStation = { stop -> onOpenStation(stop.id) },
                onOpenLine = { line -> onOpenLine("${line.operator}:${line.lineCode}") },
            )
        }
    }
}
