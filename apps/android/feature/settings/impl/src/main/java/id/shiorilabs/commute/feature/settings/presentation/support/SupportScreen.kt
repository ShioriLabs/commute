package id.shiorilabs.commute.feature.settings.presentation.support

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.HtmlText
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage

private const val SAWERIA_URL = "https://saweria.co/shiorilabs"

/** What gets shared: Commute itself, not a settings page, as on the web. */
private const val COMMUTE_URL = "https://commute.shiorilabs.id"

@Composable
fun SupportScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current
    val shareText = stringResource(R.string.settings_support_share_text)

    SupportContent(
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onShare = {
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TITLE, "Commute")
                .putExtra(Intent.EXTRA_TEXT, "$shareText\n$COMMUTE_URL")
            context.startActivity(Intent.createChooser(send, null))
        },
        onOpenSaweria = { uriHandler.openUri(SAWERIA_URL) },
    )
}

@Composable
private fun SupportContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onShare: () -> Unit = {},
    onOpenSaweria: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_support_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Column(
            modifier = Modifier.padding(start = SettingsGutter, top = 16.dp, end = SettingsGutter),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.settings_support_headline),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            HtmlText(
                html = stringResource(R.string.settings_support_intro),
                style = MaterialTheme.typography.bodyLarge,
            )
            SupportSection(
                title = stringResource(R.string.settings_support_share_title),
                body = stringResource(R.string.settings_support_share_body),
                button = stringResource(R.string.settings_support_share_button),
                icon = CommuteIcons.Share,
                onClick = onShare,
            )
            SupportSection(
                title = stringResource(R.string.settings_support_saweria_title),
                body = stringResource(R.string.settings_support_saweria_body),
                button = stringResource(R.string.settings_support_saweria_button),
                icon = CommuteIcons.ExternalLink,
                iconTrails = true,
                onClick = onOpenSaweria,
            )
        }
    }
}

/** One way to support Commute: what it is, and the button that does it. */
@Composable
private fun SupportSection(
    title: String,
    body: String,
    button: String,
    icon: ImageVector,
    onClick: () -> Unit,
    iconTrails: Boolean = false,
) {
    Column(
        // The web's mt-10 between sections.
        modifier = Modifier.padding(top = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title,
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        PillButton(text = button, icon = icon, iconTrails = iconTrails, onClick = onClick)
    }
}

/** The web's rounded-full pink button, with an icon before or after its label. */
@Composable
private fun PillButton(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
    iconTrails: Boolean = false,
) {
    val glyph = @Composable {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onPrimary,
        )
    }
    Row(
        modifier = Modifier
            .padding(top = 8.dp)
            .minimumInteractiveComponentSize()
            .background(MaterialTheme.colorScheme.primary, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!iconTrails) {
            glyph()
        }
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
        if (iconTrails) {
            glyph()
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun SupportContentPreview() {
    CommutePreviewScaffold {
        SupportContent(innerPadding = PaddingValues())
    }
}
