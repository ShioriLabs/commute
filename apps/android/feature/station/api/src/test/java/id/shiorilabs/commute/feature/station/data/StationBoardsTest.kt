package id.shiorilabs.commute.feature.station.data

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import id.shiorilabs.commute.core.query.Query
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime

class StationBoardsTest {

    private class FakeStationRepository : StationRepository {
        var station: Either<Failure, Station> = Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:B")).right()
        var timetable: (ServiceDayName) -> Either<Failure, List<LineTimetable>> =
            { listOf(LineTimetable("KCI:B", emptyList())).right() }
        val asked = mutableListOf<ServiceDayName>()
        var cache: Pair<Station, Map<ServiceDayName, List<LineTimetable>>>? = null

        override suspend fun station(stationId: String) = station

        override fun cachedStation(stationId: String) = cache?.first

        override fun cachedTimetable(stationId: String, day: ServiceDayName) = cache?.second?.get(day)

        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> {
            asked += day
            return timetable(day)
        }

        override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> = emptyList<Transfer>().right()

        var frequencies: Either<Failure, List<Frequency>> = listOf(Frequency("TJ:13", 186.0)).right()
        val askedFrequencies = mutableListOf<Pair<String, ServiceDayName>>()
        var cachedFrequencies: List<Frequency>? = null

        override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> {
            askedFrequencies += stationId to day
            return frequencies
        }

        override fun cachedFrequencies(stationId: String, day: ServiceDayName) = cachedFrequencies
    }

    private val halte = Station("TJ-H00001P", "Petukangan D'MASIV", "TJ", "H00001P", listOf("TJ:13"))

    @Test
    fun `a weekday starts loading, shows the board only after the station, and never asks for tomorrow`() = runTest {
        val repository = FakeStationRepository()

        // A Wednesday morning: tomorrow runs the same weekday board.
        val boards = repository.board("KCI-MRI", LocalDateTime.parse("2026-09-30T08:00:00")).toList()

        assertTrue(boards.first().station is UIState.Loading)
        assertTrue(boards.first().timetable is UIState.Loading)
        assertTrue(boards.none { it.station is UIState.Loading && it.timetable !is UIState.Loading })
        assertTrue(boards.last().station is UIState.Success)
        assertTrue(boards.last().timetable is UIState.Success)
        assertFalse(boards.last().nextDayDiffers)
        assertEquals(listOf(ServiceDayName.WD), repository.asked)
    }

    @Test
    fun `an old part that couldn't be refreshed marks the board outdated, as of its age`() = runTest {
        val confirmed = Instant.parse("2026-09-30T00:00:00Z")
        val repository = object : StationRepository by FakeStationRepository() {
            override fun observeStation(stationId: String) = flowOf(
                Query(
                    data = Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:B")),
                    updatedAt = confirmed,
                    failure = Failure.Network.NoConnection(),
                ),
            )
        }

        val board = repository.board("KCI-MRI", LocalDateTime.parse("2026-09-30T08:00:00")).toList().last()

        assertTrue(board.station is UIState.Success)
        assertTrue(board.isOutdated)
        assertEquals(confirmed, board.updatedAt)
    }

    @Test
    fun `a Friday also loads Saturday's board, keyed by line`() = runTest {
        val repository = FakeStationRepository()

        val board = repository.board("KCI-MRI", LocalDateTime.parse("2026-10-02T20:00:00")).toList().last()

        assertTrue(board.nextDayDiffers)
        assertEquals(setOf("KCI:B"), board.nextDayBoard?.keys)
        assertEquals(setOf(ServiceDayName.WD, ServiceDayName.SAT), repository.asked.toSet())
    }

    @Test
    fun `each part fails on its own`() = runTest {
        val repository = FakeStationRepository().apply {
            timetable = { day -> if (day == ServiceDayName.WD) Failure.Unknown().left() else emptyList<LineTimetable>().right() }
        }

        val board = repository.board("KCI-MRI", LocalDateTime.parse("2026-10-02T20:00:00")).toList().last()

        assertTrue(board.station is UIState.Success)
        assertTrue(board.timetable is UIState.Error)
        assertEquals(emptyMap<String, LineTimetable>(), board.nextDayBoard)
    }

    @Test
    fun `a failed next-day board leaves no restarts rather than an error`() = runTest {
        val repository = FakeStationRepository().apply {
            timetable = { day -> if (day == ServiceDayName.SAT) Failure.Unknown().left() else emptyList<LineTimetable>().right() }
        }

        val board = repository.board("KCI-MRI", LocalDateTime.parse("2026-10-02T20:00:00")).toList().last()

        assertTrue(board.timetable is UIState.Success)
        assertNull(board.nextDayBoard)
    }

    @Test
    fun `a board already fetched whole is emitted alone, without asking`() = runTest {
        val station = Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:B"))
        val repository = FakeStationRepository().apply {
            cache = station to mapOf(ServiceDayName.WD to listOf(LineTimetable("KCI:B", emptyList())))
        }

        val boards = repository.board("KCI-MRI", LocalDateTime.parse("2026-09-30T08:00:00")).toList()

        assertEquals(1, boards.size)
        assertEquals(station, (boards.single().station as UIState.Success).data)
        assertTrue(repository.asked.isEmpty())
    }

    @Test
    fun `a cached board missing tomorrow's starts from the cache rather than loading`() = runTest {
        val repository = FakeStationRepository().apply {
            cache = Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:B")) to
                mapOf(ServiceDayName.WD to listOf(LineTimetable("KCI:B", emptyList())))
        }

        // A Friday: Saturday's board isn't cached yet.
        val boards = repository.board("KCI-MRI", LocalDateTime.parse("2026-10-02T20:00:00")).toList()

        assertTrue(boards.none { it.station is UIState.Loading || it.timetable is UIState.Loading })
        assertEquals(setOf("KCI:B"), boards.last().nextDayBoard?.keys)
    }

    @Test
    fun `a rail station never asks for frequencies`() = runTest {
        val repository = FakeStationRepository()

        val board = repository.board("KCI-MRI", LocalDateTime.parse("2026-09-30T08:00:00")).toList().last()

        assertTrue(board.frequencies is UIState.Idle)
        assertTrue(repository.askedFrequencies.isEmpty())
    }

    @Test
    fun `a halte asks for the service day's frequencies`() = runTest {
        val repository = FakeStationRepository().apply {
            station = halte.right()
            timetable = { emptyList<LineTimetable>().right() }
        }

        val boards = repository.board("TJ-H00001P", LocalDateTime.parse("2026-09-30T08:00:00")).toList()

        assertTrue(boards.first().frequencies is UIState.Loading)
        assertEquals(listOf(Frequency("TJ:13", 186.0)), (boards.last().frequencies as UIState.Success).data)
        assertEquals(listOf("TJ-H00001P" to ServiceDayName.WD), repository.askedFrequencies)
    }

    @Test
    fun `a halte's timetable 404 reads as the empty board it is`() = runTest {
        val repository = FakeStationRepository().apply {
            station = halte.right()
            timetable = { Failure.Unknown().left() }
        }

        val board = repository.board("TJ-H00001P", LocalDateTime.parse("2026-09-30T08:00:00")).toList().last()

        assertEquals(emptyList<LineTimetable>(), (board.timetable as UIState.Success).data)
        assertTrue(board.frequencies is UIState.Success)
    }

    @Test
    fun `a halte's timetable still being asked for doesn't hold its board`() = runTest {
        val fake = FakeStationRepository().apply { station = halte.right() }
        val repository = object : StationRepository by fake {
            override fun observeTimetable(stationId: String, day: ServiceDayName) =
                flowOf(Query<List<LineTimetable>>(isFetching = true))
        }

        val board = repository.board("TJ-H00001P", LocalDateTime.parse("2026-09-30T08:00:00")).toList().last()

        assertEquals(emptyList<LineTimetable>(), (board.timetable as UIState.Success).data)
        assertTrue(board.frequencies is UIState.Success)
    }

    @Test
    fun `a halte's failed frequencies fail on their own`() = runTest {
        val repository = FakeStationRepository().apply {
            station = halte.right()
            timetable = { emptyList<LineTimetable>().right() }
            frequencies = Failure.Unknown().left()
        }

        val board = repository.board("TJ-H00001P", LocalDateTime.parse("2026-09-30T08:00:00")).toList().last()

        assertTrue(board.timetable is UIState.Success)
        assertTrue(board.frequencies is UIState.Error)
    }

    @Test
    fun `a cached halte without its frequencies still asks for them`() = runTest {
        val repository = FakeStationRepository().apply {
            cache = halte to mapOf(ServiceDayName.WD to emptyList())
        }

        val boards = repository.board("TJ-H00001P", LocalDateTime.parse("2026-09-30T08:00:00")).toList()

        assertTrue(boards.none { it.station is UIState.Loading || it.timetable is UIState.Loading })
        assertTrue(boards.last().frequencies is UIState.Success)
        assertEquals(1, repository.askedFrequencies.size)
    }

    @Test
    fun `a cached halte with its frequencies is emitted alone, without asking`() = runTest {
        val repository = FakeStationRepository().apply {
            cache = halte to mapOf(ServiceDayName.WD to emptyList())
            cachedFrequencies = emptyList()
        }

        val boards = repository.board("TJ-H00001P", LocalDateTime.parse("2026-09-30T08:00:00")).toList()

        assertEquals(1, boards.size)
        assertEquals(emptyList<Frequency>(), (boards.single().frequencies as UIState.Success).data)
        assertTrue(repository.askedFrequencies.isEmpty())
    }

    @Test
    fun `nothing cached is no cached board`() {
        assertNull(FakeStationRepository().cachedBoard("KCI-MRI", LocalDateTime.parse("2026-09-30T08:00:00")))
    }
}
