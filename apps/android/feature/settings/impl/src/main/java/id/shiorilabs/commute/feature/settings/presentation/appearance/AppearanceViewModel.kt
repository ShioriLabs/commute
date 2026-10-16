package id.shiorilabs.commute.feature.settings.presentation.appearance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.AppearancePreferencesRepository
import id.shiorilabs.commute.core.datastore.ThemeMode
import id.shiorilabs.commute.core.ext.WhileUiSubscribed
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The app's look, straight to its stored setting. */
@HiltViewModel
class AppearanceViewModel @Inject constructor(
    private val preferences: AppearancePreferencesRepository,
) : ViewModel() {

    /** `null` until read off disk, so no radio shows the wrong choice for a frame. */
    val themeMode: StateFlow<ThemeMode?> = preferences.themeMode.stateIn(viewModelScope, WhileUiSubscribed, null)

    fun setThemeMode(mode: ThemeMode) = viewModelScope.launch { preferences.setThemeMode(mode) }
}
