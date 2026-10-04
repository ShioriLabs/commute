package id.shiorilabs.commute.feature.settings.presentation.managedata

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage

/** The web's red-400 on the clear buttons. */
private val ClearColor = Color(0xFFF87171)

@Composable
fun ManageDataScreen(
    innerPadding: PaddingValues,
    viewModel: ManageDataViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    ManageDataContent(
        state = state,
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onClearRecentSearches = viewModel::clearRecentSearches,
        onClearSavedStations = viewModel::clearSavedStations,
        onClearOfflineData = viewModel::clearOfflineData,
    )
}

@Composable
private fun ManageDataContent(
    state: UIState<StoredData>,
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onClearRecentSearches: () -> Unit = {},
    onClearSavedStations: () -> Unit = {},
    onClearOfflineData: () -> Unit = {},
) {
    var confirmingSavedStations by rememberSaveable { mutableStateOf(false) }
    var confirmingOfflineData by rememberSaveable { mutableStateOf(false) }

    SettingsPage(
        title = stringResource(R.string.settings_data_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        // Read off disk within a frame or two; nothing is drawn meanwhile, as on the home screen.
        val data = (state as? UIState.Success)?.data
        if (data != null) {
            DataEntry(
                title = stringResource(R.string.settings_data_recents),
                subtitle = if (data.recentSearches > 0) {
                    stringResource(R.string.settings_data_recents_count, data.recentSearches)
                } else {
                    stringResource(R.string.settings_data_recents_empty)
                },
                canClear = data.recentSearches > 0,
                // Recent searches go without asking, as on the web: they cost nothing to rebuild.
                onClear = onClearRecentSearches,
            )
            DataEntry(
                title = stringResource(R.string.settings_data_saved),
                subtitle = if (data.savedStations > 0) {
                    stringResource(R.string.settings_data_saved_count, data.savedStations)
                } else {
                    stringResource(R.string.settings_data_saved_empty)
                },
                canClear = data.savedStations > 0,
                onClear = { confirmingSavedStations = true },
            )
            DataEntry(
                title = stringResource(R.string.settings_data_offline),
                subtitle = if (data.offlineBytes > 0) {
                    stringResource(
                        R.string.settings_data_offline_size,
                        Formatter.formatShortFileSize(LocalContext.current, data.offlineBytes),
                    )
                } else {
                    stringResource(R.string.settings_data_offline_empty)
                },
                canClear = data.offlineBytes > 0,
                // Asked first, as the web asks before clearing its cache: the copies come back as
                // stations are opened online, but until then saved stations don't open offline.
                onClear = { confirmingOfflineData = true },
            )
        }
    }

    if (confirmingSavedStations) {
        ConfirmClearDialog(
            message = stringResource(R.string.settings_data_clear_saved_confirm),
            onConfirm = onClearSavedStations,
            onDismiss = { confirmingSavedStations = false },
        )
    }
    if (confirmingOfflineData) {
        ConfirmClearDialog(
            message = stringResource(R.string.settings_data_clear_offline_confirm),
            onConfirm = onClearOfflineData,
            onDismiss = { confirmingOfflineData = false },
        )
    }
}

/** "Hapus" or "Batal" before clearing something that is slow or impossible to get back. */
@Composable
private fun ConfirmClearDialog(message: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(message) },
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    onConfirm()
                },
            ) {
                Text(stringResource(R.string.settings_data_confirm))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.settings_data_cancel))
            }
        },
    )
}

/** One kind of stored data: what it is, how much there is, and a button to clear it. */
@Composable
private fun DataEntry(
    title: String,
    subtitle: String,
    canClear: Boolean,
    onClear: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // The web's px-8 py-4.
            .padding(horizontal = SettingsGutter, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (canClear) {
            CommuteIconButton(onClick = onClear, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = CommuteIcons.Delete,
                    contentDescription = stringResource(R.string.settings_data_clear, title),
                    modifier = Modifier.size(24.dp),
                    tint = ClearColor,
                )
            }
        } else {
            Spacer(Modifier.size(32.dp))
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ManageDataContentPreview() {
    CommutePreviewScaffold {
        ManageDataContent(
            state = UIState.Success(StoredData(recentSearches = 3, savedStations = 0, offlineBytes = 1_800_000)),
            innerPadding = PaddingValues(),
        )
    }
}
