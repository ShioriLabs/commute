package id.shiorilabs.commute.feature.map.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.domain.MapData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MapViewModel @Inject constructor(
    val repository: MapRepository,
    /** Where the map was left: under a station's page, or closed earlier. */
    val session: MapSession,
) : ViewModel() {

    private val _state = MutableStateFlow<UIState<MapData>>(UIState.Loading)
    val state: StateFlow<UIState<MapData>> = _state.asStateFlow()

    init {
        load()
    }

    fun retry() {
        _state.value = UIState.Loading
        load()
    }

    private fun load() {
        viewModelScope.launch {
            _state.value = repository.mapData().fold(
                ifLeft = { UIState.Error(cause = it.cause) },
                ifRight = { UIState.Success(it) },
            )
        }
    }
}
