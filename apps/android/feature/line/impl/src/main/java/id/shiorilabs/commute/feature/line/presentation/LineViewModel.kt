package id.shiorilabs.commute.feature.line.presentation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.toUIState
import id.shiorilabs.commute.feature.line.data.LineDetailRepository
import id.shiorilabs.commute.feature.line.domain.LineDetail
import id.shiorilabs.commute.feature.line.domain.lineStrip
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel(assistedFactory = LineViewModel.Factory::class)
class LineViewModel @AssistedInject constructor(
    @Assisted("operator") private val operator: String,
    @Assisted("lineCode") private val lineCode: String,
    private val savedState: SavedStateHandle,
    private val lineDetailRepository: LineDetailRepository,
    private val lineRepository: LineRepository,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(@Assisted("operator") operator: String, @Assisted("lineCode") lineCode: String): LineViewModel
    }

    // Seeded from memory, so a line opened again this session arrives whole on its first frame.
    private val line = MutableStateFlow(
        lineDetailRepository.cachedLine(operator, lineCode)?.let { Query(it) } ?: Query(isFetching = true),
    )
    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())

    /** The branch shown inline past the junction. Kept across process death, like a scroll. */
    private val activeTail = savedState.getStateFlow(ACTIVE_TAIL, 0)
    private var load: Job? = null

    val state: StateFlow<LineUiState> = combine(line, lines, activeTail, ::uiState).stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = uiState(line.value, lines.value, activeTail.value),
    )

    init {
        load()
    }

    fun retry() {
        load()
    }

    /** A ramp's pill: shows that branch inline, and the one shown until now becomes the ramp. */
    fun onShowBranch(tailIndex: Int) {
        savedState[ACTIVE_TAIL] = tailIndex
    }

    private fun load() {
        // A retry replaces a load still in flight, which would otherwise land after it.
        load?.cancel()
        load = viewModelScope.launch {
            lineDetailRepository.observeLine(operator, lineCode).collect { line.value = it }
        }
        if (lines.value.isEmpty()) {
            viewModelScope.launch {
                lineRepository.lines().onRight { lines.value = it }
            }
        }
    }

    private fun uiState(line: Query<LineDetail>, lines: Map<String, LineInfo>, activeTail: Int): LineUiState =
        LineUiState(
            line = line.toUIState(),
            strip = line.data?.let { lineStrip(it, activeTail) },
            lines = lines,
            updatedAt = line.updatedAt,
            isOutdated = line.isOutdated,
        )

    private companion object {

        const val ACTIVE_TAIL = "activeTail"
    }
}
