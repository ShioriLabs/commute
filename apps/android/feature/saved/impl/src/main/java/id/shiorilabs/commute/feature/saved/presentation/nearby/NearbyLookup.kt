package id.shiorilabs.commute.feature.saved.presentation.nearby

import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.station.domain.NearbyStation
import id.shiorilabs.commute.feature.station.domain.nearbyStations
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Clock
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/** What a look around found: the stations near the rider home doesn't pin, and the pinned ones they're at. */
data class NearbyResult(
    val found: List<NearbyStation> = emptyList(),
    /** Nearest first: the stations home pins, or starts a pinned pair from, that the rider is at. */
    val atPinned: List<String> = emptyList(),
)

/**
 * Where the rider is, against the stations home knows: what "Di dekat kamu" shows and what home
 * raises. One for the process, so the look taken while the splash plays is the one home opens on.
 * Looks take turns, and one asked for just after another has landed is skipped: the look home
 * asks for as it first comes into view would otherwise land a second answer moments after the
 * first, moving the section twice.
 */
@Singleton
class NearbyLookup @Inject constructor(
    private val location: LocationClient,
    private val directory: StationDirectory,
    private val savedRepository: SavedRepository,
    private val locationPreferences: LocationPreferencesRepository,
    private val clock: Clock,
) {

    private val _result = MutableStateFlow(NearbyResult())
    val result: StateFlow<NearbyResult> = _result.asStateFlow()

    private val _settled = MutableStateFlow(false)

    /** Whether a look has finished, whatever it found, or that there was no look to take. */
    val settled: StateFlow<Boolean> = _settled.asStateFlow()

    private val turns = Mutex()

    /** When the last look found a fix; guarded by [turns]. */
    private var lookedAt: Instant? = null

    /**
     * Looks with a fresh fix, unless one was taken within [FRESH]: home calls it while the splash
     * plays and again as it comes back into view, the rider having likely moved.
     */
    suspend fun look() = turns.withLock {
        try {
            if (!location.hasPermission() || !locationPreferences.use.first().allowsHomeNearby) return@withLock
            val last = lookedAt
            if (last != null && Duration.between(last, clock.instant()) < FRESH) return@withLock
            val point = location.current()?.point ?: return@withLock
            val stations = directory.cached() ?: directory.stored() ?: directory.all().getOrNull() ?: return@withLock
            val saved = savedRepository.entries.first()
            val pinned = saved.filterIsInstance<SavedEntry.Station>().map { it.stationId }.toSet()
            val starts = saved.filterIsInstance<SavedEntry.Route>().map { it.fromId }.toSet()
            _result.value = NearbyResult(
                found = nearbyStations(point, stations.filter { it.id !in pinned }, limit = SHOWN),
                atPinned = nearbyStations(
                    point,
                    stations.filter { it.id in pinned || it.id in starts },
                    radiusM = RAISE_RADIUS_M,
                    limit = Int.MAX_VALUE,
                ).map { it.station.id },
            )
            lookedAt = clock.instant()
        } finally {
            _settled.value = true
        }
    }

    private companion object {

        /** Two: enough to cover "which entrance", few enough that home is still the rider's own. */
        const val SHOWN = 2

        /** Close enough to be at the station, or on the way into it: nearer than "Di dekat kamu" reaches. */
        const val RAISE_RADIUS_M = 750

        /** A look this recent still places the rider: home coming back sooner doesn't look again. */
        val FRESH: Duration = Duration.ofMinutes(1)
    }
}
