package id.shiorilabs.commute.feature.settings.presentation.savedstations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.station.domain.Station

/** The web's red-400 on an unpin. */
private val UnpinColor = Color(0xFFF87171)

@Composable
fun SavedStationsSettingsScreen(
    innerPadding: PaddingValues,
    viewModel: SavedStationsSettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    SavedStationsSettingsContent(
        state = state,
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onToggle = viewModel::onToggle,
        onMove = viewModel::onMove,
    )
}

@Composable
private fun SavedStationsSettingsContent(
    state: UIState<List<SavedStationRow>>,
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onToggle: (stationId: String) -> Unit = {},
    onMove: (stationId: String, offset: Int) -> Unit = { _, _ -> },
) {
    SettingsPage(
        title = stringResource(R.string.settings_saved_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Text(
            text = stringResource(R.string.settings_saved_hint),
            modifier = Modifier.padding(start = SettingsGutter, end = SettingsGutter, bottom = 16.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        // The list is read off disk within a frame or two; nothing is drawn meanwhile.
        val rows = (state as? UIState.Success)?.data
        when {
            rows == null -> Unit
            rows.isEmpty() -> Text(
                text = stringResource(R.string.settings_saved_empty),
                modifier = Modifier.padding(horizontal = SettingsGutter, vertical = 16.dp),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            else -> rows.forEach { row ->
                key(row.id) {
                    SavedStationRowItem(
                        row = row,
                        onToggle = { onToggle(row.id) },
                        onMove = { offset -> onMove(row.id, offset) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SavedStationRowItem(
    row: SavedStationRow,
    onToggle: () -> Unit,
    onMove: (offset: Int) -> Unit,
) {
    val station = (row.station as? UIState.Success)?.data
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // The web's px-8 py-4.
            .padding(horizontal = SettingsGutter, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (station == null) {
            StationSkeleton(modifier = Modifier.weight(1f))
        } else {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = station.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = OPERATOR_NAMES[station.operator] ?: station.operator,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                RowButton(
                    icon = CommuteIcons.MoveUp,
                    description = stringResource(R.string.settings_saved_move_up, station.name),
                    enabled = !row.isFirst,
                    onClick = { onMove(-1) },
                )
                RowButton(
                    icon = CommuteIcons.MoveDown,
                    description = stringResource(R.string.settings_saved_move_down, station.name),
                    enabled = !row.isLast,
                    onClick = { onMove(1) },
                )
                RowButton(
                    icon = if (row.isSaved) CommuteIcons.Unpin else CommuteIcons.Pinned,
                    description = stringResource(
                        if (row.isSaved) R.string.settings_saved_unpin else R.string.settings_saved_pin,
                        station.name,
                    ),
                    tint = if (row.isSaved) UnpinColor else MaterialTheme.colorScheme.onBackground,
                    onClick = onToggle,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

/**
 * One of a row's buttons. A move at the end of the list greys out rather than wrapping around, as
 * on the web.
 */
@Composable
private fun RowButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = MaterialTheme.colorScheme.onBackground,
) {
    CommuteIconButton(
        onClick = { if (enabled) onClick() },
        modifier = modifier
            .size(36.dp)
            .semantics { if (!enabled) disabled() },
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(20.dp),
            tint = if (enabled) tint else MaterialTheme.colorScheme.outline,
        )
    }
}

/** A row whose station is still loading, the web's pulsing bars. */
@Composable
private fun StationSkeleton(modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SkeletonBlock(
            modifier = Modifier
                .width(256.dp)
                .height(16.dp),
            shape = MaterialTheme.shapes.small,
        )
        SkeletonBlock(
            modifier = Modifier
                .width(128.dp)
                .height(12.dp),
            shape = MaterialTheme.shapes.small,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SavedStationsSettingsContentPreview() {
    val manggarai = Station("KCI-MRI", "Manggarai", "KCI", "MRI", emptyList())
    val bundaranHi = Station("MRTJ-BHI", "Bundaran HI Bank DKI", "MRTJ", "BHI", emptyList())
    CommutePreviewScaffold {
        SavedStationsSettingsContent(
            state = UIState.Success(
                listOf(
                    SavedStationRow("KCI-MRI", isSaved = true, UIState.Success(manggarai), isFirst = true, isLast = false),
                    SavedStationRow("MRTJ-BHI", isSaved = false, UIState.Success(bundaranHi), isFirst = false, isLast = false),
                    SavedStationRow("KCI-THB", isSaved = true, UIState.Loading, isFirst = false, isLast = true),
                ),
            ),
            innerPadding = PaddingValues(),
        )
    }
}
