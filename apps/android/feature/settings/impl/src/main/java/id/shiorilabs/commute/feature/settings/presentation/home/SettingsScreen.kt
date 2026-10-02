package id.shiorilabs.commute.feature.settings.presentation.home

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.NavCardMorphTarget
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsItem
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.VersionText

private const val DATA_PLATFORM_URL = "https://data.commute.shiorilabs.id"

/** Settings, which the home screen's "Pengaturan" card expands into: the web's settings sheet. */
@Composable
fun SettingsScreen(
    appVersion: String,
    innerPadding: PaddingValues,
) {
    val navigator = LocalNavigator.current
    val uriHandler = LocalUriHandler.current

    // Opened by the home screen's white card, so the white mask is all the morph needs.
    NavCardMorphTarget(destination = Route.Settings, cardTint = null) {
        SettingsContent(
            appVersion = appVersion,
            innerPadding = innerPadding,
            onClose = { navigator.pop() },
            onOpen = navigator::goTo,
            onOpenDataPlatform = { uriHandler.openUri(DATA_PLATFORM_URL) },
        )
    }
}

@Composable
private fun SettingsContent(
    appVersion: String,
    innerPadding: PaddingValues,
    onClose: () -> Unit = {},
    onOpen: (Route) -> Unit = {},
    onOpenDataPlatform: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_title),
        innerPadding = innerPadding,
        onBack = onClose,
        navigationIcon = CommuteIcons.Close,
        navigationDescription = stringResource(R.string.settings_close_description),
    ) {
        SettingsItem(
            label = stringResource(R.string.settings_item_saved_stations),
            icon = CommuteIcons.SavedStations,
            onClick = { onOpen(Route.SettingsSavedStations) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_item_manage_data),
            icon = CommuteIcons.ManageData,
            onClick = { onOpen(Route.SettingsManageData) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_item_legal),
            icon = CommuteIcons.Legal,
            onClick = { onOpen(Route.SettingsLegal) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_item_data_platform),
            icon = CommuteIcons.DataPlatform,
            external = true,
            onClick = onOpenDataPlatform,
        )
        SettingsItem(
            label = stringResource(R.string.settings_item_support),
            icon = CommuteIcons.Support,
            onClick = { onOpen(Route.SettingsSupport) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_item_about),
            icon = CommuteIcons.About,
            onClick = { onOpen(Route.SettingsAbout) },
        )
        VersionText(
            text = stringResource(R.string.settings_version, appVersion),
            modifier = Modifier.padding(start = SettingsGutter, top = 32.dp, end = SettingsGutter),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SettingsContentPreview() {
    CommutePreviewScaffold {
        SettingsContent(appVersion = "1.0", innerPadding = PaddingValues())
    }
}
