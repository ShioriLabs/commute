package id.shiorilabs.commute.feature.settings.presentation.experimental

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import android.content.Intent
import android.widget.Toast
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsItem
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsSwitch
import id.shiorilabs.commute.feature.trip.TripLogExport
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ExperimentalViewModel @Inject constructor(
    private val preferences: DeveloperPreferencesRepository,
    private val tripLog: TripLogExport,
) : ViewModel() {

    val forceTripStart: StateFlow<Boolean> = preferences.forceTripStart.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)
    val frostTuner: StateFlow<Boolean> = preferences.frostTuner.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    fun setForceTripStart(enabled: Boolean) = viewModelScope.launch { preferences.setForceTripStart(enabled) }

    fun setFrostTuner(enabled: Boolean) = viewModelScope.launch { preferences.setFrostTuner(enabled) }

    /** The trip log's share sheet, or `null` with nothing logged yet. */
    fun shareTripLog(onReady: (Intent?) -> Unit) = viewModelScope.launch { onReady(tripLog.share()) }

    /** Takes the page back out of settings; the seven taps bring it back. */
    fun hide() = viewModelScope.launch { preferences.setExperimentalUnlocked(false) }
}

/**
 * Switches for trying the app out. Always listed in a debug build; in any other, once the version
 * under settings is tapped seven times, and then it can be hidden again from here.
 */
@Composable
fun ExperimentalScreen(
    innerPadding: PaddingValues,
    debug: Boolean,
    viewModel: ExperimentalViewModel = hiltViewModel(),
) {
    val forceTripStart by viewModel.forceTripStart.collectAsStateWithLifecycle()
    val frostTuner by viewModel.frostTuner.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val empty = stringResource(R.string.settings_experimental_trip_log_empty)

    ExperimentalContent(
        innerPadding = innerPadding,
        forceTripStart = forceTripStart,
        frostTuner = frostTuner,
        canHide = !debug,
        onBack = { navigator.pop() },
        onForceTripStart = { viewModel.setForceTripStart(it) },
        onFrostTuner = { viewModel.setFrostTuner(it) },
        onShareTripLog = {
            viewModel.shareTripLog { intent ->
                if (intent != null) context.startActivity(intent) else Toast.makeText(context, empty, Toast.LENGTH_SHORT).show()
            }
        },
        onHide = {
            viewModel.hide()
            navigator.pop()
        },
    )
}

@Composable
private fun ExperimentalContent(
    innerPadding: PaddingValues,
    forceTripStart: Boolean,
    frostTuner: Boolean,
    canHide: Boolean,
    onBack: () -> Unit = {},
    onForceTripStart: (Boolean) -> Unit = {},
    onFrostTuner: (Boolean) -> Unit = {},
    onShareTripLog: () -> Unit = {},
    onHide: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_experimental_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Text(
            text = stringResource(R.string.settings_experimental_hint),
            modifier = Modifier.padding(start = SettingsGutter, end = SettingsGutter, bottom = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SettingsSwitch(
            title = stringResource(R.string.settings_experimental_force_trip),
            subtitle = stringResource(R.string.settings_experimental_force_trip_detail),
            checked = forceTripStart,
            onCheckedChange = onForceTripStart,
        )
        SettingsSwitch(
            title = stringResource(R.string.settings_experimental_frost_tuner),
            subtitle = stringResource(R.string.settings_experimental_frost_tuner_detail),
            checked = frostTuner,
            onCheckedChange = onFrostTuner,
        )
        SettingsItem(
            label = stringResource(R.string.settings_experimental_trip_log),
            detail = stringResource(R.string.settings_experimental_trip_log_detail),
            onClick = onShareTripLog,
        )
        if (canHide) {
            SettingsItem(
                label = stringResource(R.string.settings_experimental_hide),
                onClick = onHide,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ExperimentalContentPreview() {
    CommutePreviewScaffold {
        ExperimentalContent(innerPadding = PaddingValues(), forceTripStart = true, frostTuner = false, canHide = true)
    }
}
