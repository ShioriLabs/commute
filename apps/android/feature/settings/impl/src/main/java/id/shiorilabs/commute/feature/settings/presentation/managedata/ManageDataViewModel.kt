package id.shiorilabs.commute.feature.settings.presentation.managedata

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.RecentSearchRepository
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.type.UIState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the app keeps on the device, counted. */
data class StoredData(
    /** Places opened from search and pairs checked in OTW, as the web counts its two together. */
    val recentSearches: Int,
    /** Pinned stations and pairs. */
    val savedStations: Int,
    /** Roughly how many bytes the copies kept for offline take: stations, timetables, routes. */
    val offlineBytes: Long = 0,
)

@HiltViewModel
class ManageDataViewModel @Inject constructor(
    private val recentSearchRepository: RecentSearchRepository,
    private val savedRepository: SavedRepository,
    private val farePreferences: FarePreferencesRepository,
    private val queryClient: QueryClient,
) : ViewModel() {

    /** Not a stream: read when the page opens and again after clearing it. */
    private val offlineBytes = MutableStateFlow(0L)

    val state: StateFlow<UIState<StoredData>> = combine(
        recentSearchRepository.recents,
        farePreferences.recentRoutes,
        savedRepository.entries,
        offlineBytes,
    ) { recents, recentRoutes, saved, offline ->
        UIState.Success(
            StoredData(
                recentSearches = recents.size + recentRoutes.size,
                savedStations = saved.size,
                offlineBytes = offline,
            ),
        ) as UIState<StoredData>
    }
        .catch { emit(UIState.Error(cause = it)) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = UIState.Loading,
        )

    init {
        viewModelScope.launch { offlineBytes.value = queryClient.size() }
    }

    fun clearRecentSearches() {
        viewModelScope.launch {
            recentSearchRepository.clear()
            farePreferences.clearRecentRoutes()
        }
    }

    /** Asked for only once the rider confirmed it, as on the web. */
    fun clearSavedStations() {
        viewModelScope.launch { savedRepository.clear() }
    }

    /** Without asking, like recent searches: the copies come back as stations are opened online. */
    fun clearOfflineData() {
        viewModelScope.launch {
            queryClient.clear()
            offlineBytes.value = queryClient.size()
        }
    }
}
