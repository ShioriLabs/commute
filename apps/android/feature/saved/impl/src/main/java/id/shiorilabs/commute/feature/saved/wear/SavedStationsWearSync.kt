package id.shiorilabs.commute.feature.saved.wear

import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.wearable.WearStation
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.isTransJakarta
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hands the saved stations' timetables to the watch, for its departures complication: weekdays',
 * Saturdays' and Sundays' boards, so the watch counts down on its own any day. Sent as the saved
 * list changes, and when the watch asks; a station whose boards haven't changed isn't sent again
 * until its copy is a week old, so the watch can tell an old copy from one the phone keeps current.
 *
 * TransJakarta haltes have no timetable, and saved pairs aren't sent yet.
 */
@Singleton
class SavedStationsWearSync @Inject constructor(
    private val saved: SavedRepository,
    private val stations: StationRepository,
    private val lines: LineRepository,
    private val store: WearStationStore,
    private val clock: Clock,
    @param:ApplicationScope private val scope: CoroutineScope,
) {

    private val started = AtomicBoolean(false)
    private val running = Mutex()

    /** Follows the saved list from now on, once per process. Nothing is sent without a watch. */
    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            saved.stationIds.collectLatest { ids -> if (store.hasWatch()) sync(ids, only = null) }
        }
    }

    /**
     * Sends [stationId], or every saved station when `null`, and takes back the copies of stations
     * no longer saved: what the watch asks for.
     */
    suspend fun publish(stationId: String?) = sync(saved.stationIds.first(), only = stationId)

    private suspend fun sync(ids: List<String>, only: String?) = running.withLock {
        val wanted = ids.filterNot(::isTransJakarta)
        val sent = runCatching { store.stored() }.getOrDefault(emptyList()).associateBy { it.id }
        val now = clock.instant()
        val names = lines.lines().getOrNull().orEmpty()
        wanted.filter { only == null || it == only }.forEach { id ->
            val built = build(id, names, now) ?: return@forEach
            if (sent[id]?.isCurrent(built, now) != true) store.put(built)
        }
        if (only == null) (sent.keys - wanted.toSet()).forEach { store.remove(it) }
    }

    private suspend fun build(id: String, names: Map<String, LineInfo>, now: Instant): WearStation? {
        val station = stations.station(id).getOrNull() ?: return null
        val boards = ServiceDayName.entries.mapNotNull { day -> stations.timetable(id, day).getOrNull()?.let { day to it } }.toMap()
        if (boards.isEmpty()) return null
        return wearStation(station, boards, names, now)
    }

    /** The same boards as [built], sent within the week. */
    private fun WearStation.isCurrent(built: WearStation, now: Instant): Boolean =
        copy(builtAt = 0) == built.copy(builtAt = 0) && Duration.between(Instant.ofEpochMilli(builtAt), now) < RESEND_AFTER

    private companion object {

        /** Half the age at which the watch asks again, so a phone in use never lets it get there. */
        val RESEND_AFTER: Duration = Duration.ofDays(7)
    }
}
