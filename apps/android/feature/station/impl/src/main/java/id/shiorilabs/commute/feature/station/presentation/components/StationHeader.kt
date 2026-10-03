package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.motion.PageEasing
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.directionalBaseName
import id.shiorilabs.commute.feature.station.domain.sortLineKeysForDisplay
import id.shiorilabs.commute.feature.station.presentation.sharedLineRoundel
import id.shiorilabs.commute.feature.station.presentation.StationTitleText

/**
 * The page's header, as the web's station page draws it: the station's roundels over its name, with
 * the pin and close buttons beside them. While the station loads, the name and lines its opener
 * passed ([placeholderTitle], [placeholderLineKeys]) stand in, or skeletons without them; once it
 * has failed, only the close button is left.
 *
 * [openedFromSearch] when a search row opened the page: its roundels fly in to these, and its name
 * scales into this one. Otherwise the roundels pop in on their own as the page opens, and the name
 * arrives from the home feed's title, its "Stasiun" clipping away.
 *
 * [topInset] is the status bar's height, carried inside the header so its background reaches up
 * behind the clock.
 */
@Composable
fun StationHeader(
    stationId: String,
    station: UIState<Station>,
    lines: Map<String, LineInfo>,
    saved: Boolean,
    onToggleSave: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    placeholderTitle: String? = null,
    placeholderLineKeys: List<String> = emptyList(),
    openedFromSearch: Boolean = false,
    topInset: Dp = 0.dp,
    /** False for a station there is no page to pin: an unserved one, titled by [placeholderTitle]. */
    saveable: Boolean = true,
) {
    val shown = when (station) {
        is UIState.Success -> directionalBaseName(station.data.name) to station.data.lineKeys
        is UIState.Idle, is UIState.Loading -> placeholderTitle?.let { it to placeholderLineKeys }
        is UIState.Error -> null
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // The web's p-8 pb-4.
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (shown != null) {
                val (name, lineKeys) = shown
                StationRoundels(stationId, lineKeys, lines, shared = openedFromSearch)
                // Lands here from the title the station was opened from. From the home feed, whose
                // title is the same text, its "Stasiun" clips away in flight; a search row's name is
                // smaller, so from there it scales instead.
                StationTitleText(
                    stationId = stationId,
                    name = name,
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                    ),
                    showWords = false,
                    animateWords = !openedFromSearch,
                    scaleWithFlight = openedFromSearch,
                    modifier = Modifier.semantics { heading() },
                )
            } else if (station !is UIState.Error) {
                SkeletonBlock(
                    modifier = Modifier
                        .width(256.dp)
                        .height(24.dp),
                    shape = MaterialTheme.shapes.small,
                )
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            when {
                !saveable -> Unit

                station is UIState.Idle || station is UIState.Loading -> SkeletonBlock(
                    modifier = Modifier.size(32.dp),
                    shape = CircleShape,
                )

                station is UIState.Success -> HeaderButton(
                    icon = if (saved) CommuteIcons.Unpin else CommuteIcons.Pin,
                    description = stringResource(
                        if (saved) R.string.station_unsave_description else R.string.station_save_description,
                    ),
                    onClick = onToggleSave,
                )

                station is UIState.Error -> Unit
            }
            HeaderButton(
                icon = CommuteIcons.Close,
                description = stringResource(R.string.station_close_description),
                onClick = onClose,
            )
        }
    }
}

/** The lines that call here, in display order. Read out as one list of names. */
@Composable
private fun StationRoundels(
    stationId: String,
    lineKeys: List<String>,
    lines: Map<String, LineInfo>,
    shared: Boolean,
) {
    val keys = sortLineKeysForDisplay(lineKeys, stationId.substringBefore('-'))
    // Until the dictionary loads there is nothing to draw a roundel with.
    val resolved = keys.mapNotNull { key -> lines[key]?.let { key to it } }
    if (resolved.isEmpty()) {
        return
    }
    val description = stringResource(R.string.station_lines_description, resolved.joinToString { it.second.name })

    FlowRow(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        resolved.forEachIndexed { index, (key, line) ->
            LineRoundel(
                code = line.lineCode,
                color = line.colorCode,
                operator = line.operator,
                size = RoundelSize.SM,
                modifier = if (shared) Modifier.sharedLineRoundel(stationId, key) else Modifier.roundelPopIn(index),
            )
        }
    }
}

/** The roundels start popping in as the name is landing, one after another. */
private const val ROUNDEL_DELAY_MILLIS = 150
private const val ROUNDEL_STEP_MILLIS = 40
private const val ROUNDEL_POP_MILLIS = 200

/** Index past which the roundels share a delay, so an interchange's tenth isn't left waiting. */
private const val ROUNDEL_MAX_STAGGER = 6

/**
 * Where the roundels have nothing to fly from, as from the home feed, they pop in on the page as it
 * opens, staggered, and fade with it on the way out.
 */
@Composable
private fun Modifier.roundelPopIn(index: Int): Modifier {
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this
    val delay = ROUNDEL_DELAY_MILLIS + index.coerceAtMost(ROUNDEL_MAX_STAGGER) * ROUNDEL_STEP_MILLIS
    return with(visibilityScope) {
        this@roundelPopIn.animateEnterExit(
            enter = fadeIn(tween(ROUNDEL_POP_MILLIS, delayMillis = delay, easing = PageEasing)) +
                scaleIn(tween(ROUNDEL_POP_MILLIS, delayMillis = delay, easing = PageEasing), initialScale = 0.6f),
            exit = fadeOut(tween(ROUNDEL_POP_MILLIS / 2)),
        )
    }
}

@Composable
private fun HeaderButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    CommuteIconButton(
        onClick = onClick,
        modifier = Modifier.size(32.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StationHeaderPreview() {
    CommutePreviewScaffold {
        StationHeader(
            stationId = "KCI-MRI",
            station = UIState.Success(Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:B", "KCI:C"))),
            lines = mapOf(
                "KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI"),
                "KCI:C" to LineInfo("Lin Cikarang", "C", "#0084D8", "KCI"),
            ),
            saved = true,
            onToggleSave = {},
            onClose = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StationHeaderLoadingPreview() {
    CommutePreviewScaffold {
        StationHeader(
            stationId = "KCI-MRI",
            station = UIState.Loading,
            lines = emptyMap(),
            saved = false,
            onToggleSave = {},
            onClose = {},
        )
    }
}
