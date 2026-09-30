package id.shiorilabs.commute.feature.saved.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteEmptyState
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.saved.presentation.components.HomeNavRail

@Composable
fun SavedStationsScreen(
    innerPadding: PaddingValues,
    viewModel: SavedStationsViewModel = hiltViewModel(),
) {
    val stations by viewModel.stations.collectAsStateWithLifecycle()

    SavedStationsContent(
        stations = stations,
        innerPadding = innerPadding,
    )
}

@Composable
private fun SavedStationsContent(
    stations: UIState<List<String>>,
    innerPadding: PaddingValues,
    onSearchClick: () -> Unit = {},
    onSettingsClick: () -> Unit = {},
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (stations) {
            // Nothing is drawn while the list is read off disk: it resolves within a frame or two,
            // and a spinner that short only reads as a flicker.
            is UIState.Idle, is UIState.Loading -> Unit

            is UIState.Success -> {
                if (stations.data.isEmpty()) {
                    SavedStationsEmpty(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding),
                    )
                }
            }

            is UIState.Error -> {
                Text(
                    text = stringResource(R.string.saved_error_message),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(innerPadding)
                        .padding(16.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
            }
        }

        HomeNavRail(
            onSearchClick = onSearchClick,
            onSettingsClick = onSettingsClick,
            bottomInset = innerPadding.calculateBottomPadding(),
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

@Composable
private fun SavedStationsEmpty(
    modifier: Modifier = Modifier,
) {
    val searchLabel = stringResource(R.string.saved_nav_search_title)

    CommuteEmptyState(
        illustration = painterResource(R.drawable.img_station),
        illustrationDescription = stringResource(R.string.saved_empty_illustration_description),
        title = stringResource(R.string.saved_empty_title),
        body = stringResource(R.string.saved_empty_body, searchLabel).withBold(searchLabel),
        modifier = modifier.padding(8.dp),
    )
}

@Preview(showBackground = true)
@Composable
private fun SavedStationsEmptyPreview() {
    CommutePreviewScaffold {
        SavedStationsContent(
            stations = UIState.Success(emptyList()),
            innerPadding = PaddingValues(),
        )
    }
}
