package id.shiorilabs.commute.feature.saved.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.SavedStationsRepository
import id.shiorilabs.commute.core.type.UIState
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class SavedStationsViewModel @Inject constructor(
    savedStationsRepository: SavedStationsRepository,
) : ViewModel() {

    /** The saved station ids (`OPERATOR-CODE`), in the order they were saved. */
    val stations: StateFlow<UIState<List<String>>> = savedStationsRepository.stations
        .map<List<String>, UIState<List<String>>> { UIState.Success(it) }
        .catch { emit(UIState.Error(cause = it)) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = UIState.Loading,
        )
}
