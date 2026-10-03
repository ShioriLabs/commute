package id.shiorilabs.commute.feature.saved.startup

import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDateTime
import javax.inject.Inject

/**
 * Reads home's feed into memory while the splash plays: the pinned list, each pinned station's
 * board, the names that title each pinned pair, and the line dictionary. Home then builds its first
 * frame from memory. A pair's own trips are the journey feature's warm-up.
 */
class HomeWarmup @Inject constructor(
    private val savedRepository: SavedRepository,
    private val stationRepository: StationRepository,
    private val lineRepository: LineRepository,
    private val clock: Clock,
) : StartupWarmup {

    override suspend fun warm() = coroutineScope {
        launch { lineRepository.lines() }
        val now = LocalDateTime.now(clock)
        // The first value of each is what the disk held; a stale one goes on refreshing on its own.
        for (entry in savedRepository.entries.first()) {
            when (entry) {
                is SavedEntry.Station -> launch { stationRepository.board(entry.stationId, now).first() }
                is SavedEntry.Route -> {
                    launch { stationRepository.observeStation(entry.fromId).first() }
                    launch { stationRepository.observeStation(entry.toId).first() }
                }
            }
        }
    }
}
