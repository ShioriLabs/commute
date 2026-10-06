package id.shiorilabs.commute.feature.saved.presentation.nearby

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.HomePreferencesRepository
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import id.shiorilabs.commute.feature.station.domain.NearbyStation
import id.shiorilabs.commute.feature.station.domain.StationBoard
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDateTime
import javax.inject.Inject

/** A station near the rider with its board, as home shows it. */
data class NearbyBoard(val nearby: NearbyStation, val board: StationBoard)

sealed interface NearbyUiState {

    /** Nothing to show: no fix, nothing near, or the prompt was waved off. */
    data object Hidden : NearbyUiState

    /** Location isn't granted: a card offering "Lihat stasiun terdekat", which asks on a tap. */
    data object Prompt : NearbyUiState

    data class Stations(val boards: List<NearbyBoard>) : NearbyUiState
}

/**
 * "Di dekat kamu" on home: the nearest stations the rider hasn't pinned, with their boards; and the
 * pinned ones the rider is at, which home raises to its top ([raised]) instead. Home
 * never asks for location on its own; without it the section is a card the rider can tap or close.
 * Turned off in Pengaturan → Lokasi, there's no section at all, and no fix is taken. The looking
 * itself is [NearbyLookup]'s, begun while the splash plays.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class NearbyViewModel @Inject constructor(
    private val location: LocationClient,
    private val lookup: NearbyLookup,
    private val stationRepository: StationRepository,
    private val homePreferences: HomePreferencesRepository,
    locationPreferences: LocationPreferencesRepository,
    private val clock: Clock,
) : ViewModel() {

    private val permitted = MutableStateFlow(location.hasPermission())

    private val boards = lookup.result.map { it.found }.distinctUntilChanged().flatMapLatest { nearby ->
        if (nearby.isEmpty()) {
            flowOf(emptyList())
        } else {
            val now = LocalDateTime.now(clock)
            combine(nearby.map { near -> stationRepository.board(near.station.id, now).map { NearbyBoard(near, it) } }) { it.toList() }
        }
    }

    private val allowed = locationPreferences.use.map { it.allowsHomeNearby }

    val state: StateFlow<NearbyUiState> = combine(allowed, permitted, homePreferences.nearbyPromptDismissed, boards) { allowed, permitted, dismissed, boards ->
        when {
            !allowed -> NearbyUiState.Hidden
            !permitted -> if (dismissed) NearbyUiState.Hidden else NearbyUiState.Prompt
            boards.isEmpty() -> NearbyUiState.Hidden
            else -> NearbyUiState.Stations(boards)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), NearbyUiState.Hidden)

    /**
     * The stations the rider is at, nearest first, that home has pinned or starts a pinned pair
     * from: home lifts those entries to its top while the rider is there.
     */
    val raised: StateFlow<List<String>> = combine(allowed, permitted, lookup.result) { allowed, permitted, result ->
        if (allowed && permitted) result.atPinned else emptyList()
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * Whether [state] and [raised] have shown what the first look found, or that there's nothing to
     * look for: home holds the splash until then, so the section is in place as home opens rather
     * than pushing the feed down once it's up. Once settled it stays so; later looks only refine.
     */
    val settled: StateFlow<Boolean> =
        combine(allowed, permitted, lookup.settled, lookup.result, boards) { allowed, permitted, settled, result, boards ->
            !allowed || !permitted || (settled && boards.map { it.nearby } == result.found)
        }.scan(false) { was, now -> was || now }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** Looks again: home calls it as it comes back into view, the rider having likely moved. */
    fun refresh() {
        permitted.value = location.hasPermission()
        if (!permitted.value) return
        viewModelScope.launch { lookup.look() }
    }

    fun onPermissionResult(granted: Boolean) {
        permitted.value = granted
        if (granted) refresh()
    }

    fun dismissPrompt() {
        viewModelScope.launch { homePreferences.dismissNearbyPrompt() }
    }
}
