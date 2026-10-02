package id.shiorilabs.commute.feature.settings.presentation.about

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.HtmlText
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.VersionText

/**
 * About Commute, as the web's About page has it, minus its tap-the-version unlock: that switches on
 * the map's debug overlay, and the app has no map.
 */
@Composable
fun AboutScreen(
    appVersion: String,
    innerPadding: PaddingValues,
) {
    val navigator = LocalNavigator.current
    AboutContent(appVersion = appVersion, innerPadding = innerPadding, onBack = { navigator.pop() })
}

@Composable
private fun AboutContent(
    appVersion: String,
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
) {
    val brand = MaterialTheme.colorScheme.primary
    SettingsPage(
        title = stringResource(R.string.settings_about_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Column(
            modifier = Modifier.padding(start = SettingsGutter, top = 16.dp, end = SettingsGutter),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.img_logotype),
                contentDescription = stringResource(R.string.settings_about_logotype_description),
                modifier = Modifier.height(48.dp),
            )
            Text(
                text = stringResource(R.string.settings_about_headline),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = brand,
            )
            Text(
                text = stringResource(R.string.settings_about_intro),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            HtmlText(
                html = stringResource(R.string.settings_about_made_by),
                style = MaterialTheme.typography.bodyLarge,
                linkColor = brand,
            )
            HtmlText(
                html = stringResource(R.string.settings_about_contact),
                style = MaterialTheme.typography.bodyLarge,
                linkColor = brand,
            )
            HtmlText(
                html = stringResource(R.string.settings_about_support),
                style = MaterialTheme.typography.bodyLarge,
                linkColor = brand,
            )
            Column(modifier = Modifier.padding(top = 16.dp)) {
                VersionText(stringResource(R.string.settings_version, appVersion))
                VersionText(stringResource(R.string.settings_about_motto))
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun AboutContentPreview() {
    CommutePreviewScaffold {
        AboutContent(appVersion = "1.0", innerPadding = PaddingValues())
    }
}
