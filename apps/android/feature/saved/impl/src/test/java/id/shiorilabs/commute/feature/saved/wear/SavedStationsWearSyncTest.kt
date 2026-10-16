package id.shiorilabs.commute.feature.saved.wear

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.wearable.WearStation
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class SavedStationsWearSyncTest {

    private class FakeStore : WearStationStore {
        var watch = true
        val items = linkedMapOf<String, WearStation>()
        val puts = mutableListOf<String>()

        override suspend fun hasWatch() = watch
        override suspend fun stored() = items.values.toList()
        override suspend fun put(station: WearStation) {
            items[station.id] = station
            puts += station.id
        }
        override suspend fun remove(stationId: String) {
            items.remove(stationId)
        }
    }

    private class FakeStations : StationRepository {
        val asked = mutableListOf<Pair<String, ServiceDayName>>()

        override suspend fun station(stationId: String): Either<Failure, Station> =
            Station(stationId, "Name of $stationId", stationId.substringBefore('-'), stationId.substringAfter('-'), listOf("KCI:B")).right()

        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> {
            asked += stationId to day
            val group = DirectionGroup("S", listOf("Bogor"), null, listOf(DestinationTimetable("Bogor", null, listOf(Departure(null, 600)))))
            return listOf(LineTimetable("KCI:B", listOf(group))).right()
        }

        override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> = emptyList<Transfer>().right()
        override suspend fun frequencies(stationId: String, day: ServiceDayName, hour: Int): Either<Failure, List<Frequency>> = emptyList<Frequency>().right()
    }

    private class FakeLines : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> =
            mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")).right()
    }

    private val saved = SavedRepository(FakePreferencesDataStore())
    private val store = FakeStore()
    private val stations = FakeStations()
    private var now = Instant.parse("2026-10-16T01:00:00Z")
    private val clock = object : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant() = now
    }

    private fun TestScope.sync() = SavedStationsWearSync(saved, stations, FakeLines(), store, clock, backgroundScope)

    @Test
    fun `saved stations cross with all three kinds of day, haltes and pairs don't`() = runTest {
        saved.toggleStation("KCI-TEB")
        saved.toggleStation("TJ-H1")
        saved.toggleRoute("KCI-TEB", "KCI-SUD")
        sync().publish(null)
        assertEquals(listOf("KCI-TEB"), store.items.keys.toList())
        assertEquals(ServiceDayName.entries.map { "KCI-TEB" to it }, stations.asked)
    }

    @Test
    fun `an unsaved station's copy goes from the watch`() = runTest {
        saved.toggleStation("KCI-TEB")
        saved.toggleStation("KCI-MRI")
        val sync = sync()
        sync.publish(null)
        saved.toggleStation("KCI-MRI")
        sync.publish(null)
        assertEquals(listOf("KCI-TEB"), store.items.keys.toList())
    }

    @Test
    fun `an unchanged station isn't sent again until its copy is a week old`() = runTest {
        saved.toggleStation("KCI-TEB")
        val sync = sync()
        sync.publish(null)
        now = now.plus(Duration.ofDays(3))
        sync.publish(null)
        assertEquals(1, store.puts.size)
        now = now.plus(Duration.ofDays(5))
        sync.publish(null)
        assertEquals(2, store.puts.size)
    }

    @Test
    fun `asked for one station, only that one is sent and nothing is pruned`() = runTest {
        saved.toggleStation("KCI-TEB")
        saved.toggleStation("KCI-MRI")
        store.items["KCI-OLD"] = WearStation("KCI-OLD", "Old", 0, emptyList())
        sync().publish("KCI-MRI")
        assertEquals(listOf("KCI-OLD", "KCI-MRI"), store.items.keys.toList())
    }

    @Test
    fun `following the saved list, nothing is sent without a watch`() = runTest {
        store.watch = false
        saved.toggleStation("KCI-TEB")
        sync().start()
        runCurrent()
        assertTrue(store.items.isEmpty())
    }

    @Test
    fun `following the saved list, a station saved later is sent`() = runTest {
        sync().start()
        runCurrent()
        saved.toggleStation("KCI-TEB")
        runCurrent()
        assertEquals(listOf("KCI-TEB"), store.items.keys.toList())
    }
}
