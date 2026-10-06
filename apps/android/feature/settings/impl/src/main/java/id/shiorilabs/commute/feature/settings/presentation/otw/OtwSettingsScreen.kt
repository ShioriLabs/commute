package id.shiorilabs.commute.feature.settings.presentation.otw

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsSwitch

/** How the trip page shows a trip under way: for now, whether its board draws the stops ahead. */
@Composable
fun OtwSettingsScreen(
    innerPadding: PaddingValues,
    viewModel: OtwSettingsViewModel = hiltViewModel(),
) {
    val pidsDiagram by viewModel.pidsDiagram.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    OtwSettingsContent(
        pidsDiagram = pidsDiagram,
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onPidsDiagram = { viewModel.setPidsDiagram(it) },
    )
}

@Composable
private fun OtwSettingsContent(
    pidsDiagram: Boolean?,
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onPidsDiagram: (Boolean) -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_otw_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        // Read off disk within a frame or two; nothing is drawn meanwhile, as on Lokasi.
        if (pidsDiagram == null) return@SettingsPage
        SettingsSwitch(
            title = stringResource(R.string.settings_otw_pids_diagram),
            subtitle = stringResource(R.string.settings_otw_pids_diagram_detail),
            checked = pidsDiagram,
            onCheckedChange = onPidsDiagram,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun OtwSettingsContentPreview() {
    CommutePreviewScaffold {
        OtwSettingsContent(pidsDiagram = true, innerPadding = PaddingValues())
    }
}
