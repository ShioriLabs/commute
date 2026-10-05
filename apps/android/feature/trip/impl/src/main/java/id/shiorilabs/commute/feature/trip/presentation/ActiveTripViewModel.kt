package id.shiorilabs.commute.feature.trip.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.runtime.FinishedTrip
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ActiveTripUiState(
    /** `null` once the trip has ended (or there never was one). */
    val trip: ActiveTrip?,
    /** The line dictionary, keyed `OPERATOR:CODE`; empty until it loads. */
    val lines: Map<String, LineInfo> = emptyMap(),
    /** Each station's lines, by station id: what the board offers to change to. Empty until read. */
    val stationLines: Map<String, List<String>> = emptyMap(),
    /** "Posisi akurat saat OTW" is off in Pengaturan → Lokasi: the trip runs by the clock by choice. */
    val tripFixesOff: Boolean = false,
    /** The trip that just ended, while [trip] is `null`, for the page's last word on it. */
    val finished: FinishedTrip? = null,
)

@HiltViewModel
class ActiveTripViewModel @Inject constructor(
    private val controller: TripControllerImpl,
    private val lineRepository: LineRepository,
    private val directory: StationDirectory,
    private val barState: TripBarState,
    developerPreferences: DeveloperPreferencesRepository,
    locationPreferences: LocationPreferencesRepository,
) : ViewModel() {

    private val lines = MutableStateFlow(lineRepository.cachedLines().orEmpty())
    private val stationLines = MutableStateFlow(directory.cached()?.toLineIndex().orEmpty())

    val state: StateFlow<ActiveTripUiState> = combine(
        controller.active,
        lines,
        stationLines,
        locationPreferences.use.map { !it.allowsTripFixes },
        controller.finished,
        ::ActiveTripUiState,
    )
        .stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            ActiveTripUiState(controller.active.value, lines.value, stationLines.value, finished = controller.finished.value),
        )

    init {
        // Opened from the foreground: if the system stopped the location service while the app was
        // away, this is where it may run again.
        controller.resumeTracking()
        viewModelScope.launch { lineRepository.lines().onRight { lines.value = it } }
        if (stationLines.value.isEmpty()) {
            viewModelScope.launch { directory.all().onRight { stationLines.value = it.toLineIndex() } }
        }
    }

    fun say(action: RiderAction) = controller.riderSaid(action)

    fun stop() = controller.stop()

    /** "Tandai manual" in Pengaturan → Experimental: the bar of marks under the page. */
    val manualMarks: StateFlow<Boolean> = developerPreferences.manualMarks
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** What the rider saw the train do, logged with what [pids] (the board then) said. */
    fun mark(kind: MarkKind, pids: Pids) = controller.mark(
        kind.key,
        mapOf(
            "boardLabel" to pids.label,
            "boardStation" to pids.station,
            "boardStopsLeft" to pids.stopsLeft,
            "boardMinutesLeft" to pids.minutesLeft,
        ),
    )

    /** The board's big name went out of sight under the trip bar, or came back. */
    fun onBoardNameHidden(hidden: Boolean) {
        barState.boardNameHidden = hidden
    }
}

private fun List<Station>.toLineIndex(): Map<String, List<String>> = associate { it.id to it.lineKeys }

