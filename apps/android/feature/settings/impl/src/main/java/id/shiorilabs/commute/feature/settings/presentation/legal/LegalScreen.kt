package id.shiorilabs.commute.feature.settings.presentation.legal

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsItem
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsSectionLabel

/** Legal & attributions: the legal documents, then the attributions, each its own page. */
@Composable
fun LegalScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current

    LegalContent(
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onOpen = navigator::goTo,
    )
}

@Composable
private fun LegalContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onOpen: (Route) -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_legal_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Spacer(Modifier.height(16.dp))
        SettingsSectionLabel(stringResource(R.string.settings_legal_section_legal))
        SettingsItem(
            label = stringResource(R.string.settings_legal_item_privacy),
            onClick = { onOpen(Route.SettingsPrivacyPolicy) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_legal_item_terms),
            onClick = { onOpen(Route.SettingsTerms) },
        )
        // The web's border-b-2 slate-200 between the two groups.
        HorizontalDivider(
            modifier = Modifier.fillMaxWidth(),
            thickness = 2.dp,
            color = MaterialTheme.colorScheme.surfaceVariant,
        )
        SettingsSectionLabel(
            text = stringResource(R.string.settings_legal_section_attributions),
            modifier = Modifier.padding(top = 32.dp),
        )
        SettingsItem(
            label = stringResource(R.string.settings_legal_item_data),
            onClick = { onOpen(Route.SettingsDataAttributions) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_legal_item_oss),
            onClick = { onOpen(Route.SettingsOssAttributions) },
        )
        SettingsItem(
            label = stringResource(R.string.settings_legal_item_creative),
            onClick = { onOpen(Route.SettingsCreativeAssets) },
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LegalContentPreview() {
    CommutePreviewScaffold {
        LegalContent(innerPadding = PaddingValues())
    }
}
