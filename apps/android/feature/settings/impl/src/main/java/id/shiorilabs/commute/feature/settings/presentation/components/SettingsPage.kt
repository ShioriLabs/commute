package id.shiorilabs.commute.feature.settings.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R

/** The settings pages are white, not the app's tinted background, as on web. */
internal val SettingsBackground = Color.White

/** The web's p-8: the side margin every settings page lines its content up on. */
internal val SettingsGutter = 32.dp

/**
 * A settings page as the web draws one: the title with a back button beside it, pinned at the top,
 * and [content] scrolling below. [navigationIcon] is the back caret, or the close X on the root
 * page, which the web shows as a sheet.
 */
@Composable
internal fun SettingsPage(
    title: String,
    innerPadding: PaddingValues,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    navigationIcon: ImageVector = CommuteIcons.Back,
    navigationDescription: String = stringResource(R.string.settings_back_description),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(SettingsBackground),
    ) {
        SettingsTopBar(
            title = title,
            onBack = onBack,
            navigationIcon = navigationIcon,
            navigationDescription = navigationDescription,
            modifier = Modifier.padding(top = innerPadding.calculateTopPadding()),
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
        ) {
            content()
            Spacer(Modifier.height(16.dp + innerPadding.calculateBottomPadding()))
        }
    }
}

@Composable
private fun SettingsTopBar(
    title: String,
    onBack: () -> Unit,
    navigationIcon: ImageVector,
    navigationDescription: String,
    modifier: Modifier = Modifier,
) {
    // A back caret leads the title; the root page's close X trails it, as on the web's sheet.
    val leading = navigationIcon != CommuteIcons.Close
    val button = @Composable {
        CommuteIconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
            Icon(
                imageVector = navigationIcon,
                contentDescription = navigationDescription,
                modifier = Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            // The web's p-8 pb-4, less its -ml-2 beside a caret, so the glyph lines up with the
            // content rather than its button.
            .padding(
                start = if (leading) SettingsGutter - 8.dp else SettingsGutter,
                top = SettingsGutter,
                end = SettingsGutter,
                bottom = 16.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (leading) {
            button()
        }
        Text(
            text = title,
            modifier = Modifier
                .weight(1f)
                .semantics { heading() },
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (!leading) {
            button()
        }
    }
}

/** The version line under the settings list and on About, in the web's slate monospace. */
@Composable
internal fun VersionText(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodyMedium,
        fontFamily = FontFamily.Monospace,
        color = MaterialTheme.colorScheme.tertiary,
    )
}

@Preview(showBackground = true)
@Composable
private fun SettingsPagePreview() {
    CommutePreviewScaffold {
        SettingsPage(title = "Atur Data", innerPadding = PaddingValues(), onBack = {}) {
            Text("Isi halaman", modifier = Modifier.padding(horizontal = SettingsGutter))
        }
    }
}
