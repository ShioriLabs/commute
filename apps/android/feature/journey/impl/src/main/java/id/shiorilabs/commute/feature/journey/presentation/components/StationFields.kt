package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Slate300
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.presentation.PairEndpoint
import id.shiorilabs.commute.feature.search.domain.SearchLine
import kotlin.math.pow

/** How deep a field stacks a stop's roundels: the web caps the panel at two. */
private const val ENDPOINT_ROUNDELS_MAX = 2

/** Each roundel behind the anchor sits this far under it, and this much smaller. */
private val RoundelOverlap = 16.dp
private const val ROUNDEL_STACK_SCALE = 0.85f

/**
 * The Dari and Ke fields, one card with the swap button straddling its divider: the web's
 * `FarePanel` header.
 */
@Composable
internal fun StationFields(
    origin: PairEndpoint?,
    destination: PairEndpoint?,
    onPickOrigin: () -> Unit,
    onPickDestination: () -> Unit,
    onSwap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .border(2.dp, Stone200, MaterialTheme.shapes.medium),
        ) {
            StationField(label = stringResource(R.string.journey_from), endpoint = origin, onClick = onPickOrigin)
            HorizontalDivider(thickness = 2.dp, color = Stone200)
            StationField(label = stringResource(R.string.journey_to), endpoint = destination, onClick = onPickDestination)
        }
        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 16.dp)
                .zIndex(1f)
                .shadow(2.dp, CircleShape)
                .clip(CircleShape)
                .background(Color.White)
                .border(2.dp, Stone200, CircleShape)
                .clickable(role = Role.Button, onClick = onSwap)
                .padding(12.dp),
        ) {
            Icon(
                imageVector = CommuteIcons.Swap,
                contentDescription = stringResource(R.string.journey_swap_description),
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun StationField(label: String, endpoint: PairEndpoint?, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Stone100)
            .clickable(role = Role.Button, onClick = onClick)
            // Clear of the swap button on the right.
            .padding(start = 16.dp, top = 10.dp, end = 64.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            modifier = Modifier.width(32.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = Slate500,
        )
        EndpointMark(lines = endpoint?.station?.lines.orEmpty().takeLast(ENDPOINT_ROUNDELS_MAX), operator = endpoint?.station?.operator)
        when {
            endpoint == null -> Text(
                text = stringResource(R.string.journey_pick_station),
                style = MaterialTheme.typography.bodyLarge,
                color = Slate400,
            )

            else -> Text(
                text = endpoint.name ?: stringResource(R.string.journey_station_loading),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * A stop's roundels stacked as a deck, the anchor (its last line) on top and readable, each behind
 * it smaller: the web's `EndpointMark`. A grey dot holds the column when there is nothing to show.
 */
@Composable
private fun EndpointMark(lines: List<SearchLine>, operator: String?) {
    Box(modifier = Modifier.width(24.dp), contentAlignment = Alignment.CenterEnd) {
        if (lines.isEmpty()) {
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Slate300),
            )
        } else {
            lines.reversed().forEachIndexed { depth, line ->
                val scale = ROUNDEL_STACK_SCALE.pow(depth)
                LineRoundel(
                    code = line.lineCode,
                    color = line.colorCode,
                    operator = operator,
                    size = RoundelSize.SM,
                    modifier = Modifier
                        .zIndex((lines.size - depth).toFloat())
                        .offset(x = -RoundelOverlap * depth)
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            transformOrigin = TransformOrigin(1f, 0.5f)
                        },
                )
            }
        }
    }
}
