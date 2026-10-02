package id.shiorilabs.commute.feature.settings.presentation.legal

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.DocumentBody
import id.shiorilabs.commute.feature.settings.presentation.components.HtmlText
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage

/** The web's blue-600 on the library links. */
private val LibraryLinkColor = Color(0xFF2563EB)

@Composable
fun OssAttributionsScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current
    OssAttributionsContent(innerPadding = innerPadding, onBack = { navigator.pop() })
}

@Composable
private fun OssAttributionsContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_oss_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        DocumentBody {
            HtmlText(stringResource(R.string.settings_oss_intro))
            Text(
                text = "@commute/android",
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.bodyLarge,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            LibraryGroup(stringResource(R.string.settings_oss_runtime), OSS_RUNTIME_LIBRARIES)
            LibraryGroup(stringResource(R.string.settings_oss_build), OSS_BUILD_LIBRARIES)
        }
    }
}

@Composable
private fun LibraryGroup(
    title: String,
    libraries: List<OssLibrary>,
) {
    val uriHandler = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        libraries.forEach { library ->
            Column {
                Text(
                    text = library.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = stringResource(R.string.settings_oss_license, library.license),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = library.url,
                    modifier = Modifier.clickable(role = Role.Button) { uriHandler.openUri(library.url) },
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    color = LibraryLinkColor,
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun OssAttributionsContentPreview() {
    CommutePreviewScaffold {
        OssAttributionsContent(innerPadding = PaddingValues())
    }
}
