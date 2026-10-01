package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.navCardMorphSource
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.saved.R

/** Where the rail's backdrop turns from transparent to the solid page background. */
private const val BACKDROP_SOLID_FROM = 0.5f

/**
 * The home screen's bottom rail of entry points, over a backdrop that fades the list out beneath
 * it. It scrolls horizontally so it keeps working once it holds more cards than fit a phone.
 *
 * @param bottomInset the system navigation bar's height, kept clear below the cards.
 */
@Composable
fun HomeNavRail(
    onSearchClick: () -> Unit,
    onSettingsClick: () -> Unit,
    modifier: Modifier = Modifier,
    bottomInset: Dp = 0.dp,
) {
    val background = MaterialTheme.colorScheme.background
    val railDescription = stringResource(R.string.saved_nav_rail_description)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    BACKDROP_SOLID_FROM to background,
                    1f to background,
                ),
            )
            .semantics { contentDescription = railDescription }
            .horizontalScroll(rememberScrollState())
            .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp + bottomInset),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        NavRailCard(
            title = stringResource(R.string.saved_nav_search_title),
            subtitle = stringResource(R.string.saved_nav_search_subtitle),
            description = stringResource(R.string.saved_nav_search_description),
            icon = CommuteIcons.Search,
            onClick = onSearchClick,
            // First in the card's chain, so the bounds the morph starts from are the card's own.
            modifier = Modifier.navCardMorphSource(Route.Search),
            accent = true,
        )
        NavRailCard(
            title = stringResource(R.string.saved_nav_settings_title),
            subtitle = stringResource(R.string.saved_nav_settings_subtitle),
            description = stringResource(R.string.saved_nav_settings_description),
            icon = CommuteIcons.Settings,
            onClick = onSettingsClick,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun HomeNavRailPreview() {
    CommutePreviewScaffold {
        HomeNavRail(
            onSearchClick = {},
            onSettingsClick = {},
        )
    }
}
