package id.shiorilabs.commute.feature.saved.startup

import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.saved.presentation.nearby.NearbyLookup
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.board
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDateTime
import javax.inject.Inject

/**
 * Looks for the stations near the rider while the splash plays, and reads their boards into memory,
 * so home opens with "Di dekat kamu" (and what it raises) already in place rather than pushing the
 * feed down once it's up. The pinned stations' boards are [HomeWarmup]'s.
 */
class NearbyWarmup @Inject constructor(
    private val lookup: NearbyLookup,
    private val stationRepository: StationRepository,
    private val clock: Clock,
) : StartupWarmup {

    override suspend fun warm() = coroutineScope {
        lookup.look()
        val now = LocalDateTime.now(clock)
        for (near in lookup.result.value.found) {
            launch { stationRepository.board(near.station.id, now).first() }
        }
    }
}
