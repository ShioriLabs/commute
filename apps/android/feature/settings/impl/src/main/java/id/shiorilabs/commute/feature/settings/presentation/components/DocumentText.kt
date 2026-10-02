package id.shiorilabs.commute.feature.settings.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route

/** The legal pages' links, the web's blue-500. */
internal val DocumentLinkColor = Color(0xFF3B82F6)

/** The scheme of a link that opens another settings page rather than the browser. */
private const val ROUTE_SCHEME = "route:"

/** The settings pages a `route:` link can name, by the slug after the scheme. */
private val LINKED_PAGES: Map<String, Route> = mapOf(
    "privacy-policy" to Route.SettingsPrivacyPolicy,
    "terms" to Route.SettingsTerms,
    "data-attributions" to Route.SettingsDataAttributions,
    "creative-assets" to Route.SettingsCreativeAssets,
    "support" to Route.SettingsSupport,
)

/**
 * A paragraph of copy with inline HTML (`<b>`, `<i>`, `<br>`, `<a href>`), as the strings in
 * `strings.xml` carry it. A `route:<slug>` link opens that settings page; any other opens outside
 * the app.
 *
 * @param linkColor the links' colour: the web's blue on the legal pages, the brand pink on About.
 */
@Composable
internal fun HtmlText(
    html: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    linkColor: Color = DocumentLinkColor,
) {
    val navigator = LocalNavigator.current
    val uriHandler = LocalUriHandler.current
    val text = remember(html, linkColor) {
        val listener = LinkInteractionListener { link ->
            val url = (link as? LinkAnnotation.Url)?.url ?: return@LinkInteractionListener
            if (url.startsWith(ROUTE_SCHEME)) {
                LINKED_PAGES[url.removePrefix(ROUTE_SCHEME)]?.let(navigator::goTo)
            } else {
                uriHandler.openUri(url)
            }
        }
        AnnotatedString.fromHtml(
            htmlString = html,
            linkStyles = TextLinkStyles(SpanStyle(color = linkColor, fontWeight = FontWeight.SemiBold)),
            linkInteractionListener = listener,
        )
    }
    Text(
        text = text,
        modifier = modifier,
        style = style,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** A numbered section's heading in a legal document, the web's `h2 font-bold text-base`. */
@Composable
internal fun DocumentHeading(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier.semantics { heading() },
        style = MaterialTheme.typography.bodyLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** A bulleted list, the web's `list-disc ml-4`. */
@Composable
internal fun DocumentBullets(
    items: List<String>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(top = 4.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items.forEach { item ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "•",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = item,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
    }
}

/**
 * The body of a text page: the web's `mt-8 px-8 text-sm` column, with a paragraph's worth of
 * space between blocks where the web puts its `<br />`s.
 */
@Composable
internal fun DocumentBody(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.padding(start = SettingsGutter, top = 16.dp, end = SettingsGutter),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        content()
    }
}

/** A legal document's numbered section: its [title] with the paragraphs and lists under it. */
@Composable
internal fun DocumentSection(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        DocumentHeading(title)
        content()
    }
}
