package id.shiorilabs.commute.feature.settings.presentation.otw

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.OtwPreferencesRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** How the trip page shows a trip under way, each switch straight to its stored setting. */
@HiltViewModel
class OtwSettingsViewModel @Inject constructor(
    private val preferences: OtwPreferencesRepository,
) : ViewModel() {

    /** `null` until read off disk, so no switch shows the wrong way round for a frame. */
    val pidsDiagram: StateFlow<Boolean?> = preferences.pidsDiagram.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setPidsDiagram(enabled: Boolean) = viewModelScope.launch { preferences.setPidsDiagram(enabled) }
}
