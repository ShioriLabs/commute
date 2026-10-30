package id.shiorilabs.commute.feature.settings.presentation.otw

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.OtwPreferencesRepository
import id.shiorilabs.commute.core.ext.WhileUiSubscribed
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
    val pidsDiagram: StateFlow<Boolean?> = preferences.pidsDiagram.stateIn(viewModelScope, WhileUiSubscribed, null)

    val reminderTune: StateFlow<Boolean?> = preferences.reminderTune.stateIn(viewModelScope, WhileUiSubscribed, null)

    fun setPidsDiagram(enabled: Boolean) = viewModelScope.launch { preferences.setPidsDiagram(enabled) }

    fun setReminderTune(enabled: Boolean) = viewModelScope.launch { preferences.setReminderTune(enabled) }
}
