package id.shiorilabs.commute.feature.settings.presentation.home

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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

/** Taps on the version that list the Experimental page, and how many of the last are counted down aloud. */
private const val EXPERIMENTAL_TAPS = 7
private const val EXPERIMENTAL_TAPS_COUNTED = 3

/** Settings, which the home screen's "Pengaturan" card expands into: the web's settings sheet. */
@Composable
fun SettingsScreen(
    appVersion: String,
    innerPadding: PaddingValues,
    debug: Boolean = false,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current
    val resources = LocalResources.current
    val unlocked by viewModel.experimentalUnlocked.collectAsStateWithLifecycle()
    val showExperimental = debug || unlocked
    // Seven taps on the version list the Experimental page, as Android's build number does its
    // developer options; the last few say how many are left. One toast at a time, the newest.
    var taps by remember { mutableIntStateOf(0) }
    var toast by remember { mutableStateOf<Toast?>(null) }
    fun say(text: String) {
        toast?.cancel()
        toast = Toast.makeText(context, text, Toast.LENGTH_SHORT).also { it.show() }
    }
    val onVersionTap = {
        if (showExperimental) {
            say(resources.getString(R.string.settings_experimental_already_open))
        } else {
            taps++
            val left = EXPERIMENTAL_TAPS - taps
            when {
                left <= 0 -> {
                    viewModel.unlockExperimental()
                    say(resources.getString(R.string.settings_experimental_opened))
                }
                left <= EXPERIMENTAL_TAPS_COUNTED -> say(resources.getString(R.string.settings_experimental_taps_left, left))
            }
        }
    }

    // Opened by the home screen's white card, so the white mask is all the morph needs.
    NavCardMorphTarget(destination = Route.Settings, cardTint = null) {
        SettingsContent(
            appVersion = appVersion,
            innerPadding = innerPadding,
            showExperimental = showExperimental,
            onVersionTap = onVersionTap,
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
    showExperimental: Boolean = false,
    onVersionTap: () -> Unit = {},
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
            label = stringResource(R.string.settings_item_location),
            icon = CommuteIcons.Location,
            onClick = { onOpen(Route.SettingsLocation) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_item_otw),
            icon = CommuteIcons.Otw,
            onClick = { onOpen(Route.SettingsOtw) },
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
        if (showExperimental) {
            SettingsItem(
                label = stringResource(R.string.settings_item_experimental),
                icon = CommuteIcons.Experimental,
                onClick = { onOpen(Route.SettingsExperimental) },
            )
        }
        VersionText(
            text = stringResource(R.string.settings_version, appVersion),
            modifier = Modifier
                .padding(start = SettingsGutter, top = 32.dp, end = SettingsGutter)
                .clickable(interactionSource = null, indication = null, onClick = onVersionTap),
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
