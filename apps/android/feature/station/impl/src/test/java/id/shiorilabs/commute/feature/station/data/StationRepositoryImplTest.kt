package id.shiorilabs.commute.feature.station.data

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer as TransferDto
import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.impl.LineRepositoryImpl
import id.shiorilabs.commute.feature.station.data.impl.StationDirectoryImpl
import id.shiorilabs.commute.feature.station.data.impl.StationRepositoryImpl
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.ServiceHours
import id.shiorilabs.commute.feature.station.domain.Transfer
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.testing.FakeNetworkMonitor
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * Against responses captured from the live API (trimmed), decoded the way the app decodes them, so
 * this also holds the generated models to what the API actually sends.
 */
class StationRepositoryImplTest {

    // The app's own configuration (JsonModule): unknown keys are ignored.
    private val json = Json { ignoreUnknownKeys = true }

    private inline fun <reified T> fixture(name: String): T {
        val body = checkNotNull(javaClass.getResource("/$name")).readText()
        return json.decodeFromJsonElement(json.parseToJsonElement(body).jsonObject.getValue("data"))
    }

    private val store = FakeQueryStore()

    /** A cache over [store]; a second one is a later launch, reading back what the first wrote. */
    private fun TestScope.queries() = QueryClient(
        store = store,
        networkMonitor = FakeNetworkMonitor(),
        clock = Clock.fixed(Instant.parse("2026-10-03T10:00:00Z"), ZoneOffset.UTC),
        scope = backgroundScope,
    )

    @Test
    fun `every part survives a trip through the disk`() = runTest {
        val service = FakeCommuteService().apply {
            station = { _, _ -> fixture<Station>("station.json") }
            groupedTimetable = { _, _, _ -> fixture<List<GroupedTimetable>>("timetable.json") }
            transfers = { _, _ -> fixture<List<TransferDto>>("transfers.json") }
            headway = { _, _, _ -> fixture<List<HeadwayRow>>("headway.json") }
            operators = { fixture<List<OperatorWithLines>>("operators.json") }
        }
        val online = StationRepositoryImpl(service, queries())
        val onlineLines = LineRepositoryImpl(service, queries())
        val fetched = listOf(
            online.station("KCI-MRI"),
            online.timetable("KCI-MRI", ServiceDayName.WD),
            online.transfers("KCI-MRI"),
            online.frequencies("KCI-MRI", ServiceDayName.WD),
            onlineLines.lines(),
        ).map { it.getOrNull() }

        // The next launch, offline: a fresh cache, so everything comes back off the disk.
        val offline = FakeCommuteService()
        val later = StationRepositoryImpl(offline, queries())
        val laterLines = LineRepositoryImpl(offline, queries())
        val stored = listOf(
            later.station("KCI-MRI"),
            later.timetable("KCI-MRI", ServiceDayName.WD),
            later.transfers("KCI-MRI"),
            later.frequencies("KCI-MRI", ServiceDayName.WD),
            laterLines.lines(),
        ).map { it.getOrNull() }

        assertTrue(fetched.none { it == null })
        assertEquals(fetched, stored)
    }

    @Test
    fun `a stored station is observed at once, then revalidated with its ETag`() = runTest {
        val service = FakeCommuteService().apply {
            etag = "W/\"1\""
            station = { _, _ -> fixture<Station>("station.json") }
        }
        StationRepositoryImpl(service, queries()).station("KCI-MRI")

        // An hour and more later, the deploy hasn't changed it: a 304.
        val later = QueryClient(store, FakeNetworkMonitor(), Clock.fixed(Instant.parse("2026-10-03T12:00:00Z"), ZoneOffset.UTC), backgroundScope)
        val revalidated = StationRepositoryImpl(service, later).observeStation("KCI-MRI")
            .first { it.updatedAt == Instant.parse("2026-10-03T12:00:00Z") }

        assertEquals("Manggarai", revalidated.data?.name)
        assertEquals("W/\"1\"", service.lastIfNoneMatch)
        assertEquals(2, service.stationCalls)
        // The 304 confirmed the stored body rather than writing it again.
        assertEquals(1, store.puts)
    }

    @Test
    fun `the directory carries coordinates and is asked for once`() = runTest {
        val service = FakeCommuteService().apply { stations = { fixture<List<Station>>("stations.json") } }
        val directory = StationDirectoryImpl(service, queries())

        val stations = directory.all().getOrNull()!!
        directory.all()

        val sudirman = stations.single { it.id == "KCI-SUD" }
        assertEquals(-6.2027, sudirman.latitude!!, 0.001)
        assertEquals(106.8233, sudirman.longitude!!, 0.001)
        // A station without coordinates is still listed, just unplaceable.
        assertTrue(stations.any { it.latitude == null })
        assertEquals(stations, directory.cached())
        assertEquals(1, service.stationsCalls)
    }

    @Test
    fun `a station decodes even with values its enums never had`() = runTest {
        // The fixture carries an amenity type and a region code the API has not shipped (yet).
        val service = FakeCommuteService().apply { station = { _, _ -> fixture<Station>("station.json") } }

        val station = StationRepositoryImpl(service, queries()).station("KCI-MRI").getOrNull()!!

        assertEquals("KCI-MRI", station.id)
        assertEquals("Manggarai", station.name)
        assertEquals(listOf("KCI:A", "KCI:B", "KCI:C"), station.lineKeys)
    }

    @Test
    fun `a station carries its amenities and coordinates for the station page`() = runTest {
        val service = FakeCommuteService().apply { station = { _, _ -> fixture<Station>("station.json") } }

        val station = StationRepositoryImpl(service, queries()).station("KCI-MRI").getOrNull()!!

        assertEquals(Amenity("ESCALATOR_UNPAID", "Kedua sisi pintu masuk"), station.amenities[4])
        assertEquals(Amenity("TOILET", null), station.amenities.first())
        // A type the app doesn't know yet is kept, not dropped: the page labels it with the raw type.
        assertEquals("SOMETHING_ADDED_LATER", station.amenities.last().type)
        assertEquals(-6.21, station.latitude!!, 0.0)
        assertEquals(106.8498, station.longitude!!, 0.0)
    }

    @Test
    fun `the id is split into operator and code, and the day is sent by name`() = runTest {
        var asked: Triple<String, String, String>? = null
        val service = FakeCommuteService().apply {
            groupedTimetable = { operator, code, day ->
                asked = Triple(operator, code, day)
                fixture<List<GroupedTimetable>>("timetable.json")
            }
        }

        StationRepositoryImpl(service, queries()).timetable("KCI-MRI", ServiceDayName.SAT)

        assertEquals(Triple("KCI", "MRI", "SAT"), asked)
    }

    @Test
    fun `departure times become minutes since midnight`() = runTest {
        val service = FakeCommuteService().apply {
            groupedTimetable = { _, _, _ -> fixture<List<GroupedTimetable>>("timetable.json") }
        }

        val line = StationRepositoryImpl(service, queries()).timetable("KCI-MRI", ServiceDayName.WD).getOrNull()!!.single()

        assertEquals("KCI:B", line.lineKey)
        val group = line.groups.single()
        assertEquals(listOf("Depok", "Citayam", "Bogor"), group.label)
        assertEquals("11/12", group.platformCode)
        assertEquals(Departure("1470", 15), group.destinations.first().departures.first())
    }

    @Test
    fun `the line dictionary is keyed by operator and code, and fetched once`() = runTest {
        val service = FakeCommuteService().apply { operators = { fixture<List<OperatorWithLines>>("operators.json") } }
        val repository = LineRepositoryImpl(service, queries())

        val lines = repository.lines().getOrNull()!!
        repository.lines()

        assertEquals(setOf("KCI:C", "KCI:B", "MRTJ:M"), lines.keys)
        assertEquals("KCI", lines.getValue("KCI:B").operator)
        assertTrue(lines.getValue("MRTJ:M") is LineInfo)
        assertEquals(1, service.operatorsCalls)
    }

    @Test
    fun `a failed dictionary fetch is retried next time`() = runTest {
        var fail = true
        val service = FakeCommuteService().apply {
            operators = { if (fail) throw IOException("offline") else emptyList() }
        }
        val repository = LineRepositoryImpl(service, queries())

        assertTrue(repository.lines().leftOrNull() is Failure.Network.NoConnection)
        fail = false
        assertTrue(repository.lines().isRight())
    }

    @Test
    fun `a fetched station and board are kept for the session, and offered without asking`() = runTest {
        var stationCalls = 0
        var timetableCalls = 0
        val service = FakeCommuteService().apply {
            station = { _, _ -> stationCalls++; fixture<Station>("station.json") }
            groupedTimetable = { _, _, _ -> timetableCalls++; fixture<List<GroupedTimetable>>("timetable.json") }
        }
        val repository = StationRepositoryImpl(service, queries())
        assertEquals(null, repository.cachedStation("KCI-MRI"))

        repository.station("KCI-MRI")
        repository.timetable("KCI-MRI", ServiceDayName.WD)
        repository.station("KCI-MRI")
        repository.timetable("KCI-MRI", ServiceDayName.WD)

        assertEquals(1, stationCalls)
        assertEquals(1, timetableCalls)
        assertEquals("Manggarai", repository.cachedStation("KCI-MRI")?.name)
        assertEquals("KCI:B", repository.cachedTimetable("KCI-MRI", ServiceDayName.WD)?.single()?.lineKey)
        // Another day type is another board.
        assertEquals(null, repository.cachedTimetable("KCI-MRI", ServiceDayName.SAT))
    }

    @Test
    fun `a failure or an empty board is asked for again`() = runTest {
        var fail = true
        var timetableCalls = 0
        val service = FakeCommuteService().apply {
            station = { _, _ -> if (fail) throw IOException("offline") else fixture<Station>("station.json") }
            groupedTimetable = { _, _, _ -> timetableCalls++; emptyList() }
        }
        val repository = StationRepositoryImpl(service, queries())

        assertTrue(repository.station("KCI-MRI").isLeft())
        assertEquals(null, repository.cachedStation("KCI-MRI"))
        fail = false
        assertTrue(repository.station("KCI-MRI").isRight())

        repository.timetable("KCI-TJ", ServiceDayName.WD)
        repository.timetable("KCI-TJ", ServiceDayName.WD)
        assertEquals(2, timetableCalls)
    }

    // Two of Sudirman's live transfers (trimmed), then LRT Jabodebek Halim's EXTERNAL one to KCIC.
    @Test
    fun `transfers decode both kinds`() = runTest {
        val service = FakeCommuteService().apply { transfers = { _, _ -> fixture<List<TransferDto>>("transfers.json") } }

        val transfers = StationRepositoryImpl(service, queries()).transfers("KCI-SUD").getOrNull()!!

        assertEquals(
            Transfer.Internal(
                id = "T-KCI-SUD-MRTJ-DKA",
                distanceM = 90,
                notes = "Keluar lewat pintu B, lalu jalan lewat Terowongan Kendal dan belok kanan",
                stationId = "MRTJ-DKA",
                name = "Dukuh Atas BNI",
                operator = "MRTJ",
                lineKeys = listOf("MRTJ:M"),
            ),
            transfers[0],
        )
        assertEquals(null, transfers[1].notes)
        assertEquals(
            Transfer.External(
                id = "T-LRTJBDB-HAL-XHSR",
                distanceM = 230,
                notes = "Keluar lewat pintu A, lalu jalan terus hingga Stasiun KCIC Halim",
                name = "Halim",
                operatorName = "KCIC",
            ),
            transfers[2],
        )
    }

    @Test
    fun `a station with no transfers is asked once`() = runTest {
        val service = FakeCommuteService().apply { transfers = { _, _ -> emptyList() } }
        val repository = StationRepositoryImpl(service, queries())

        repository.transfers("KCI-THB")
        repository.transfers("KCI-THB")

        assertEquals(1, service.transfersCalls)
        assertEquals(emptyList<Transfer>(), repository.cachedTransfers("KCI-THB"))
    }

    @Test
    fun `a halte's frequencies decode every shape the API sends`() = runTest {
        var asked: Triple<String, String, String>? = null
        val service = FakeCommuteService().apply {
            headway = { operator, code, day ->
                asked = Triple(operator, code, day)
                fixture<List<HeadwayRow>>("headway.json")
            }
        }

        val rows = StationRepositoryImpl(service, queries()).frequencies("TJ-H00001P", ServiceDayName.WD).getOrNull()!!

        assertEquals(Triple("TJ", "H00001P", "WD"), asked)
        assertEquals(
            Frequency("TJ:13", 186.0, boundFor = "Tegal Mampang", serviceHours = ServiceHours.AllDay),
            rows[0],
        )
        assertEquals(ServiceHours.Window("05:00", "22:00"), rows[2].serviceHours)
        // Weekend-only on a weekday: no figure, the days it runs instead, and hours unknown.
        assertEquals(
            Frequency("TJ:13E", null, days = setOf(ServiceDayName.SAT, ServiceDayName.SUN)),
            rows[4],
        )
        assertEquals(setOf(ServiceDayName.WD), rows[5].days)
    }

    @Test
    fun `a day the app doesn't know is dropped, and hours missing an end are unknown`() = runTest {
        val service = FakeCommuteService().apply {
            headway = { _, _, _ ->
                json.decodeFromString<List<HeadwayRow>>(
                    """[
                        {"line":"TJ:1","headwayS":300,"source":"STOP","days":["SAT","HOL"],"serviceHours":{"start":"05:00"}},
                        {"line":"TJ:2","headwayS":300,"source":"STOP","days":["HOL"]}
                    ]""",
                )
            }
        }

        val rows = StationRepositoryImpl(service, queries()).frequencies("TJ-H00001P", ServiceDayName.SAT).getOrNull()!!

        assertEquals(setOf(ServiceDayName.SAT), rows[0].days)
        assertEquals(null, rows[0].serviceHours)
        assertEquals(null, rows[1].days)
    }

    @Test
    fun `frequencies are kept per day, an empty answer included`() = runTest {
        val service = FakeCommuteService().apply { headway = { _, _, _ -> emptyList() } }
        val repository = StationRepositoryImpl(service, queries())

        repository.frequencies("TJ-H00001P", ServiceDayName.WD)
        repository.frequencies("TJ-H00001P", ServiceDayName.WD)
        repository.frequencies("TJ-H00001P", ServiceDayName.SAT)

        assertEquals(2, service.headwayCalls)
        assertEquals(emptyList<Frequency>(), repository.cachedFrequencies("TJ-H00001P", ServiceDayName.WD))
        assertEquals(null, repository.cachedFrequencies("TJ-H00001P", ServiceDayName.SUN))
    }
}
