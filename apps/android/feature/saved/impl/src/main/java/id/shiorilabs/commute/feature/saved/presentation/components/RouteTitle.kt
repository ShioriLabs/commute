package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.saved.R

/** A name not loaded yet: the title keeps its height rather than collapsing. */
private const val NAME_LOADING = "…"

/**
 * A pinned pair's title on the home feed, "Sudirman → Bogor", the web's saved-route heading. It
 * opens the pair on the OTW page.
 *
 * Set like [StationTitle], the same text in the same padding, so the bar over the feed measures and
 * slides the two alike. Each name gives way before the arrow does, so a long pair still reads both
 * ends.
 */
@Composable
fun RouteTitle(
    fromName: String?,
    toName: String?,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
    onClick: (() -> Unit)? = null,
) {
    val from = fromName ?: NAME_LOADING
    val to = toName ?: NAME_LOADING
    val description = stringResource(R.string.saved_route_title_description, from, to)
    val style = MaterialTheme.typography.titleLarge.copy(
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(16.dp)
            .semantics(mergeDescendants = true) {
                heading()
                contentDescription = description
            },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = from, modifier = Modifier.weight(1f, fill = false), style = style, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(
            imageVector = CommuteIcons.ArrowRight,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onBackground,
        )
        Text(text = to, modifier = Modifier.weight(1f, fill = false), style = style, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Preview(showBackground = true)
@Composable
private fun RouteTitlePreview() {
    CommutePreviewScaffold {
        RouteTitle(fromName = "Sudirman", toName = "Bogor")
    }
}
