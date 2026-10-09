package id.shiorilabs.commute.feature.settings.presentation.legal

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.DocumentBody
import id.shiorilabs.commute.feature.settings.presentation.components.DocumentLinkColor
import id.shiorilabs.commute.feature.settings.presentation.components.HtmlText
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage

@Composable
fun DataAttributionsScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current
    DataAttributionsContent(innerPadding = innerPadding, onBack = { navigator.pop() })
}

@Composable
private fun DataAttributionsContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_data_attr_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        DocumentBody {
            HtmlText(stringResource(R.string.settings_data_attr_intro))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AttributionEntry(
                    name = "Commuter Line",
                    url = "https://commuterline.id/perjalanan-krl/jadwal-kereta",
                    body = stringResource(R.string.settings_data_attr_kci_body),
                    owner = "© KAI Commuter",
                )
                AttributionEntry(
                    name = "MRT Jakarta",
                    url = "https://jakartamrt.co.id/id/rencana-perjalanan",
                    body = stringResource(R.string.settings_data_attr_mrtj_body),
                    owner = "© MRT Jakarta",
                )
                AttributionEntry(
                    name = "LRT Jakarta",
                    url = "https://www.lrtjakarta.co.id/jadwal.html",
                    body = stringResource(R.string.settings_data_attr_lrtj_body),
                    owner = "© LRT Jakarta",
                )
                AttributionEntry(
                    name = "LRT Jabodebek",
                    url = "https://www.instagram.com/lrt_jabodebek",
                    body = stringResource(R.string.settings_data_attr_lrtjbdb_body),
                    owner = "© Kereta Api Indonesia",
                )
                AttributionEntry(
                    name = stringResource(R.string.settings_data_attr_fdtj_name),
                    url = "https://transportforjakarta.or.id",
                    body = stringResource(R.string.settings_data_attr_fdtj_body),
                    owner = "© FDTJ",
                )
                AttributionEntry(
                    name = "OpenStreetMap",
                    url = "https://www.openstreetmap.org/copyright",
                    body = stringResource(R.string.settings_data_attr_osm_body),
                    owner = "© OpenStreetMap contributors",
                    licenseUrl = "https://opendatacommons.org/licenses/odbl/1-0/",
                )
            }
            HtmlText(stringResource(R.string.settings_data_attr_outro))
        }
    }
}

@Composable
fun CreativeAssetsScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current
    CreativeAssetsContent(innerPadding = innerPadding, onBack = { navigator.pop() })
}

@Composable
private fun CreativeAssetsContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_creative_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        DocumentBody {
            HtmlText(stringResource(R.string.settings_creative_intro))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AttributionEntry(
                    name = "Irasutoya",
                    url = "https://www.irasutoya.com",
                    body = stringResource(R.string.settings_creative_irasutoya_body),
                    owner = "© Takashi Mifune",
                    licenseUrl = "https://www.irasutoya.com/p/terms.html",
                )
                AttributionEntry(
                    name = "Phosphor Icons",
                    url = "https://phosphoricons.com/",
                    body = stringResource(R.string.settings_creative_phosphor_body),
                    owner = "© Helena Zhang, Tobias Fried",
                    licenseUrl = "https://github.com/phosphor-icons/core/blob/main/LICENSE",
                )
                AttributionEntry(
                    name = "Plus Jakarta Sans",
                    url = "https://github.com/tokotype/PlusJakartaSans",
                    body = stringResource(R.string.settings_creative_jakarta_sans_body),
                    owner = "© Gumpita Rahayu dari Tokotype",
                    licenseUrl = "https://github.com/tokotype/PlusJakartaSans/blob/master/OFL.txt",
                )
            }
        }
    }
}

/**
 * One source on an attribution page: its [name], a link to it, what is used and how ([body], which
 * may carry inline HTML), and whose it is, with where its licence is when it has one.
 */
@Composable
private fun AttributionEntry(
    name: String,
    url: String,
    body: String,
    owner: String,
    licenseUrl: String? = null,
) {
    val uriHandler = LocalUriHandler.current
    Column {
        Text(
            text = name,
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = url,
            modifier = Modifier.clickable(role = Role.Button) { uriHandler.openUri(url) },
            style = MaterialTheme.typography.bodyMedium,
            color = DocumentLinkColor,
        )
        HtmlText(body)
        Text(
            text = owner,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (licenseUrl != null) {
            HtmlText(stringResource(R.string.settings_creative_license, licenseUrl))
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun DataAttributionsContentPreview() {
    CommutePreviewScaffold {
        DataAttributionsContent(innerPadding = PaddingValues())
    }
}

@Preview(showBackground = true)
@Composable
private fun CreativeAssetsContentPreview() {
    CommutePreviewScaffold {
        CreativeAssetsContent(innerPadding = PaddingValues())
    }
}
