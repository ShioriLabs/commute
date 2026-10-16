package id.shiorilabs.commute.feature.settings.presentation.appearance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.datastore.ThemeMode
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.components.Badge
import id.shiorilabs.commute.core.ui.components.reportIssueUrl
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.HtmlText
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsRadio

/** Pengaturan → Tema: the phone's setting, light, dark or black. Beta. */
@Composable
fun AppearanceScreen(
    innerPadding: PaddingValues,
    viewModel: AppearanceViewModel = hiltViewModel(),
) {
    val mode by viewModel.themeMode.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    AppearanceContent(
        mode = mode,
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onMode = { viewModel.setThemeMode(it) },
    )
}

@Composable
private fun AppearanceContent(
    mode: ThemeMode?,
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onMode: (ThemeMode) -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_appearance_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = SettingsGutter, vertical = 8.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Badge(text = stringResource(R.string.settings_beta), modifier = Modifier.padding(top = 2.dp))
            HtmlText(
                html = stringResource(R.string.settings_appearance_beta_detail, reportIssueUrl()),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                linkColor = MaterialTheme.colorScheme.primary,
            )
        }
        // Read off disk within a frame or two; no radio is drawn meanwhile.
        if (mode == null) return@SettingsPage
        SettingsRadio(
            title = stringResource(R.string.settings_appearance_system),
            detail = stringResource(R.string.settings_appearance_system_detail),
            selected = mode == ThemeMode.System,
            onSelect = { onMode(ThemeMode.System) },
        )
        SettingsRadio(
            title = stringResource(R.string.settings_appearance_light),
            selected = mode == ThemeMode.Light,
            onSelect = { onMode(ThemeMode.Light) },
        )
        SettingsRadio(
            title = stringResource(R.string.settings_appearance_dark),
            selected = mode == ThemeMode.Dark,
            onSelect = { onMode(ThemeMode.Dark) },
        )
        SettingsRadio(
            title = stringResource(R.string.settings_appearance_black),
            detail = stringResource(R.string.settings_appearance_black_detail),
            selected = mode == ThemeMode.Black,
            onSelect = { onMode(ThemeMode.Black) },
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun AppearanceContentPreview() {
    CommutePreviewScaffold {
        AppearanceContent(mode = ThemeMode.System, innerPadding = PaddingValues())
    }
}
