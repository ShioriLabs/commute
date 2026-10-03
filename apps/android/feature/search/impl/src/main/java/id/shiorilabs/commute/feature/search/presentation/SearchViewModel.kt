package id.shiorilabs.commute.feature.search.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.RecentSearch
import id.shiorilabs.commute.core.datastore.RecentSearchRepository
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.datastore.SearchMode
import id.shiorilabs.commute.core.datastore.SearchModeRepository
import id.shiorilabs.commute.core.ext.toLoading
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toUserMessage
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.search.domain.MIN_QUERY_LENGTH
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.domain.rankSearchables
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
    private val recentSearchRepository: RecentSearchRepository,
    private val savedRepository: SavedRepository,
    private val searchModeRepository: SearchModeRepository,
) : ViewModel() {

    /**
     * Which tab shows: one station, or OTW. `null` until the stored choice is read, so a rider who
     * left on OTW does not get the station tab's keyboard first.
     */
    val mode: StateFlow<SearchMode?> = searchModeRepository.mode
        .stateIn(viewModelScope, SharingStarted.Eagerly, initialValue = null)

    private val _index = MutableStateFlow<UIState<List<Searchable>>>(UIState.Idle)

    private val _query = MutableStateFlow("")

    /** What the rider has typed. Updated synchronously so the field never lags a keystroke. */
    val query: StateFlow<String> = _query.asStateFlow()

    /*
     * Ranking scores every entry against every keystroke, which is the work the web defers with
     * useDeferredValue. Here it runs off the main thread, and mapLatest drops a ranking still in
     * flight when the next keystroke lands, so typing never waits on it.
     */
    private val results = combine(_index, _query) { index, query -> index to query }
        .mapLatest { (index, query) ->
            val searchables = (index as? UIState.Success)?.data
            when {
                query.length < MIN_QUERY_LENGTH || searchables == null -> SearchResults.None
                else -> withContext(Dispatchers.Default) {
                    val ranked = rankSearchables(searchables, query)
                    if (ranked.isEmpty()) SearchResults.NotFound(query) else SearchResults.Found(query, ranked)
                }
            }
        }

    val state: StateFlow<UIState<SearchUiState>> = combine(
        _index,
        results,
        recentSearchRepository.recents,
        savedRepository.stationIds,
    ) { index, results, recents, saved ->
        when (index) {
            is UIState.Idle -> UIState.Idle
            is UIState.Loading -> UIState.Loading
            is UIState.Error -> index
            is UIState.Success -> UIState.Success(
                SearchUiState(
                    idle = idleContent(index.data, recents, saved),
                    results = results,
                    savedStationIds = saved.toSet(),
                ),
            )
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = UIState.Loading,
    )

    init {
        load()
    }

    fun onQueryChange(query: String) {
        _query.value = query
    }

    fun retry() {
        load()
    }

    /** Switches tab, and remembers it for the next time search opens. */
    fun onModeChange(mode: SearchMode) {
        viewModelScope.launch {
            searchModeRepository.setMode(mode)
        }
    }

    /** Remembers a station or hub the rider opened, for the "Terakhir dicari" list. */
    fun onResultClick(searchable: Searchable) {
        val recent = when (searchable) {
            is Searchable.Station -> searchable.stationId?.let { RecentSearch(RecentSearch.Type.STATION, it) }
            is Searchable.Hub -> searchable.hubId?.let { RecentSearch(RecentSearch.Type.HUB, it) }
            is Searchable.Line -> null
        } ?: return

        viewModelScope.launch {
            recentSearchRepository.record(recent)
        }
    }

    /** The pin on a station row: saves the station to the home screen, or unsaves it. */
    fun onToggleSave(stationId: String) {
        viewModelScope.launch {
            savedRepository.toggleStation(stationId)
        }
    }

    fun onClearRecents() {
        viewModelScope.launch {
            recentSearchRepository.clear()
        }
    }

    private fun load() {
        viewModelScope.launch {
            _index.toLoading(isRefreshing = false)
            searchRepository.searchables().fold(
                ifLeft = { _index.value = UIState.Error(it.toUserMessage(), it.cause) },
                ifRight = { _index.value = UIState.Success(it) },
            )
        }
    }
}
