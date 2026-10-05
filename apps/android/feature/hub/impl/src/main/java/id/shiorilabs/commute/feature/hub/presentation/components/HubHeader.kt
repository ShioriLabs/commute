package id.shiorilabs.commute.feature.hub.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.hub.R
import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.hub.domain.HubKind

/** The kind under the name, the web's `text-slate-500`. */
private val KindColor = Color(0xFF64748B)

/**
 * The page's header, as the web's hub page draws it: the hub's name over its kind, with the close
 * button beside them. While the hub loads, [placeholderTitle] stands in for the name, or a skeleton
 * without one; once it has failed, only the close button is left.
 *
 * [topInset] is the status bar's height, carried inside the header so the frost reaches up behind
 * the clock.
 */
@Composable
fun HubHeader(
    hub: UIState<Hub>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    placeholderTitle: String? = null,
    topInset: Dp = 0.dp,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // The web's p-8 pb-4, as on the station page.
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            val loaded = (hub as? UIState.Success)?.data
            val title = loaded?.name ?: placeholderTitle.takeIf { hub !is UIState.Error }
            when {
                title != null -> Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.semantics { heading() },
                )

                hub !is UIState.Error -> SkeletonBlock(
                    modifier = Modifier
                        .width(256.dp)
                        .height(24.dp),
                    shape = MaterialTheme.shapes.small,
                )
            }
            if (loaded != null) {
                Text(
                    text = stringResource(
                        when (loaded.kind) {
                            HubKind.HUB -> R.string.hub_kind_hub
                            HubKind.INTEGRATED -> R.string.hub_kind_integrated
                        },
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = KindColor,
                )
            }
        }
        CommuteCloseButton(
            onClick = onClose,
            contentDescription = stringResource(R.string.hub_close_description),
            tint = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun HubHeaderPreview() {
    CommutePreviewScaffold {
        HubHeader(
            hub = UIState.Success(Hub("dukuh-atas", "Dukuh Atas", HubKind.HUB, emptyList())),
            onClose = {},
        )
    }
}
