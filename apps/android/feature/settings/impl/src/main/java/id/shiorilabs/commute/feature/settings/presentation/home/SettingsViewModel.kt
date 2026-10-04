package id.shiorilabs.commute.feature.settings.presentation.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Whether settings list the Experimental page, and the seven taps on the version that unlock it. */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val developerPreferences: DeveloperPreferencesRepository,
) : ViewModel() {

    val experimentalUnlocked: StateFlow<Boolean> =
        developerPreferences.experimentalUnlocked.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    fun unlockExperimental() = viewModelScope.launch { developerPreferences.setExperimentalUnlocked(true) }
}
