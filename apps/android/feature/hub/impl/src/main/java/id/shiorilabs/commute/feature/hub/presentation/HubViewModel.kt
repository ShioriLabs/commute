package id.shiorilabs.commute.feature.hub.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.toUIState
import id.shiorilabs.commute.feature.hub.data.HubRepository
import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel(assistedFactory = HubViewModel.Factory::class)
class HubViewModel @AssistedInject constructor(
    @Assisted private val slug: String,
    private val hubRepository: HubRepository,
    private val lineRepository: LineRepository,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(slug: String): HubViewModel
    }

    // Seeded from memory, so a hub opened again this session arrives whole on its first frame.
    private val hub = MutableStateFlow(hubRepository.cachedHub(slug)?.let { Query(it) } ?: Query(isFetching = true))
    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())
    private var load: Job? = null

    val state: StateFlow<HubUiState> = combine(hub, lines, ::uiState).stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = uiState(hub.value, lines.value),
    )

    init {
        load()
    }

    fun retry() {
        load()
    }

    private fun load() {
        // A retry replaces a load still in flight, which would otherwise land after it.
        load?.cancel()
        load = viewModelScope.launch {
            hubRepository.observeHub(slug).collect { hub.value = it }
        }
        if (lines.value.isEmpty()) {
            viewModelScope.launch {
                lineRepository.lines().onRight { lines.value = it }
            }
        }
    }

    private fun uiState(hub: Query<Hub>, lines: Map<String, LineInfo>): HubUiState = HubUiState(
        hub = hub.toUIState(),
        lines = lines,
        updatedAt = hub.updatedAt,
        isOutdated = hub.isOutdated,
    )
}
