package id.shiorilabs.commute.feature.settings.presentation.location

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.datastore.LocationUse
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the app may use the rider's location for, each switch straight to its stored setting. */
@HiltViewModel
class LocationSettingsViewModel @Inject constructor(
    private val preferences: LocationPreferencesRepository,
) : ViewModel() {

    /** `null` until read off disk, so no switch shows the wrong way round for a frame. */
    val use: StateFlow<LocationUse?> = preferences.use.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setEnabled(enabled: Boolean) = viewModelScope.launch { preferences.setEnabled(enabled) }

    fun setHomeNearby(enabled: Boolean) = viewModelScope.launch { preferences.setHomeNearby(enabled) }

    fun setPickerNearby(enabled: Boolean) = viewModelScope.launch { preferences.setPickerNearby(enabled) }

    fun setTripFixes(enabled: Boolean) = viewModelScope.launch { preferences.setTripFixes(enabled) }
}
