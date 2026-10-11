package id.shiorilabs.commute.feature.onboarding.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.OnboardingPreferencesRepository
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Remembers that the rider went past the welcome page, so the app opens on home from then on. */
@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val onboardingPreferences: OnboardingPreferencesRepository,
) : ViewModel() {

    fun finish() = viewModelScope.launch { onboardingPreferences.complete() }
}
