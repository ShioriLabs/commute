package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.presentation.RecentRouteRow

/*
 * Pinning a Dari→Ke pair to home, the web's `SaveRouteButton`, and the pairs search offers back,
 * its `RecentRouteList`.
 */

/**
 * The pin under the answer in search's OTW tab, as a plate that says what it does. In "Rute
 * terakhir"'s fill, as the web sets its square.
 */
@Composable
internal fun SaveRoutePlate(saved: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Stone100, MaterialTheme.shapes.medium)
            .border(2.dp, Stone200, MaterialTheme.shapes.medium)
            .clickable(role = Role.Button) {
                haptics.performHapticFeedback(if (saved) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn)
                onClick()
            }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (saved) CommuteIcons.Pinned else CommuteIcons.Pin,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = stringResource(if (saved) R.string.journey_unsave_route else R.string.journey_save_route),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * "Rute terakhir": the pairs that last answered, each asked for again on tap, with a pin that puts
 * it on home. Shown only while the tab has no complete pair, where it reads as "pick up where you
 * left off" rather than competing with an answer.
 */
@Composable
internal fun RecentRoutes(
    routes: List<RecentRouteRow>,
    onOpen: (RecentRouteRow) -> Unit,
    onTogglePin: (RecentRouteRow) -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (routes.isEmpty()) {
        return
    }
    val haptics = LocalHapticFeedback.current
    Column(modifier = modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.journey_recent_routes),
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = Slate500,
            )
            Text(
                text = stringResource(R.string.journey_recent_routes_clear),
                modifier = Modifier.clickable(role = Role.Button, onClick = onClear),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        routes.forEach { route ->
            val description = stringResource(R.string.journey_recent_route_description, route.fromName, route.toName)
            Row(
                modifier = Modifier.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(role = Role.Button) { onOpen(route) }
                        .semantics(mergeDescendants = true) { contentDescription = description }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = route.fromName,
                        modifier = Modifier.weight(1f, fill = false),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Icon(
                        imageVector = CommuteIcons.ArrowRight,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = Slate500,
                    )
                    Text(
                        text = route.toName,
                        modifier = Modifier.weight(1f, fill = false),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                // The same pin as a station row's, so a pinned pair and a pinned station read alike.
                CommuteIconButton(
                    onClick = {
                        haptics.performHapticFeedback(if (route.saved) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn)
                        onTogglePin(route)
                    },
                    modifier = Modifier.size(44.dp),
                ) {
                    Icon(
                        imageVector = if (route.saved) CommuteIcons.Pinned else CommuteIcons.Pin,
                        contentDescription = stringResource(
                            if (route.saved) R.string.journey_recent_route_unpin else R.string.journey_recent_route_pin,
                            route.fromName,
                            route.toName,
                        ),
                        modifier = Modifier.size(24.dp),
                        tint = if (route.saved) MaterialTheme.colorScheme.primary else Slate300,
                    )
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun RecentRoutesPreview() {
    CommutePreviewScaffold {
        RecentRoutes(
            routes = listOf(
                RecentRouteRow("KCI-BOO", "KCI-SUD", "Bogor", "Sudirman", saved = true),
                RecentRouteRow("KCI-SUD", "MRTJ-LBB", "Sudirman", "Lebak Bulus Grab", saved = false),
            ),
            onOpen = {},
            onTogglePin = {},
            onClear = {},
            modifier = Modifier.padding(16.dp),
        )
    }
}
