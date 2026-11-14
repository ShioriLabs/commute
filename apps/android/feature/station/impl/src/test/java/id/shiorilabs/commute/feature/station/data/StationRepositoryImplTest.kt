package id.shiorilabs.commute.feature.station.data

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.StationDensity
import id.shiorilabs.commute.core.model.models.StationExit as StationExitDto
import id.shiorilabs.commute.core.model.models.Transfer as TransferDto
import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.impl.LineRepositoryImpl
import id.shiorilabs.commute.feature.station.data.impl.StationDirectoryImpl
import id.shiorilabs.commute.feature.station.data.impl.StationRepositoryImpl
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.CrowdLevel
import id.shiorilabs.commute.feature.station.domain.CrowdRange
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.ExitSign
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.ServiceHours
import id.shiorilabs.commute.feature.station.domain.SignKind
import id.shiorilabs.commute.feature.station.domain.StationExit
import id.shiorilabs.commute.feature.station.domain.Transfer
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.testing.FakeNetworkMonitor
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
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
        val onlineLines = LineRepositoryImpl(service, queries(), backgroundScope)
        val fetched = listOf(
            online.station("KCI-MRI").fetch(),
            online.timetable("KCI-MRI", ServiceDayName.WD).fetch(),
            online.transfers("KCI-MRI").fetch(),
            online.frequencies("KCI-MRI", ServiceDayName.WD, 8).fetch(),
            onlineLines.lines(),
        ).map { it.getOrNull() }

        // The next launch, offline: a fresh cache, so everything comes back off the disk.
        val offline = FakeCommuteService()
        val later = StationRepositoryImpl(offline, queries())
        val laterLines = LineRepositoryImpl(offline, queries(), backgroundScope)
        val stored = listOf(
            later.station("KCI-MRI").fetch(),
            later.timetable("KCI-MRI", ServiceDayName.WD).fetch(),
            later.transfers("KCI-MRI").fetch(),
            later.frequencies("KCI-MRI", ServiceDayName.WD, 8).fetch(),
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
        StationRepositoryImpl(service, queries()).station("KCI-MRI").fetch()

        // An hour and more later, the deploy hasn't changed it: a 304.
        val later = QueryClient(store, FakeNetworkMonitor(), Clock.fixed(Instant.parse("2026-10-03T12:00:00Z"), ZoneOffset.UTC), backgroundScope)
        val revalidated = StationRepositoryImpl(service, later).station("KCI-MRI").observe()
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

        val station = StationRepositoryImpl(service, queries()).station("KCI-MRI").fetch().getOrNull()!!

        assertEquals("KCI-MRI", station.id)
        assertEquals("Manggarai", station.name)
        assertEquals(listOf("KCI:A", "KCI:B", "KCI:C"), station.lineKeys)
    }

    @Test
    fun `a station carries its amenities and coordinates for the station page`() = runTest {
        val service = FakeCommuteService().apply { station = { _, _ -> fixture<Station>("station.json") } }

        val station = StationRepositoryImpl(service, queries()).station("KCI-MRI").fetch().getOrNull()!!

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

        StationRepositoryImpl(service, queries()).timetable("KCI-MRI", ServiceDayName.SAT).fetch()

        assertEquals(Triple("KCI", "MRI", "SAT"), asked)
    }

    @Test
    fun `departure times become minutes since midnight`() = runTest {
        val service = FakeCommuteService().apply {
            groupedTimetable = { _, _, _ -> fixture<List<GroupedTimetable>>("timetable.json") }
        }

        val line = StationRepositoryImpl(service, queries()).timetable("KCI-MRI", ServiceDayName.WD).fetch().getOrNull()!!.single()

        assertEquals("KCI:B", line.lineKey)
        val group = line.groups.single()
        assertEquals(listOf("Depok", "Citayam", "Bogor"), group.label)
        assertEquals("11/12", group.platformCode)
        assertEquals(Departure("1470", 15), group.destinations.first().departures.first())
    }

    @Test
    fun `the line dictionary is keyed by operator and code, and fetched once`() = runTest {
        val service = FakeCommuteService().apply { operators = { fixture<List<OperatorWithLines>>("operators.json") } }
        val repository = LineRepositoryImpl(service, queries(), backgroundScope)

        val lines = repository.lines().getOrNull()!!
        repository.lines()

        assertEquals(setOf("KCI:C", "KCI:B", "MRTJ:M"), lines.keys)
        assertEquals("KCI", lines.getValue("KCI:B").operator)
        assertTrue(lines.getValue("MRTJ:M") is LineInfo)
        assertEquals(1, service.operatorsCalls)
    }

    @Test
    fun `the dictionary is held for every screen once answered, and read off the disk at the next launch`() = runTest {
        val service = FakeCommuteService().apply { operators = { fixture<List<OperatorWithLines>>("operators.json") } }
        val repository = LineRepositoryImpl(service, queries(), backgroundScope)
        assertTrue(repository.dictionary.value.isEmpty())

        repository.lines()
        assertEquals(setOf("KCI:C", "KCI:B", "MRTJ:M"), repository.dictionary.value.keys)

        // The next launch, offline: nobody asks, and it's there all the same.
        val later = LineRepositoryImpl(FakeCommuteService(), queries(), backgroundScope)
        runCurrent()
        assertEquals(setOf("KCI:C", "KCI:B", "MRTJ:M"), later.dictionary.value.keys)
    }

    @Test
    fun `a failed dictionary fetch is retried next time`() = runTest {
        var fail = true
        val service = FakeCommuteService().apply {
            operators = { if (fail) throw IOException("offline") else emptyList() }
        }
        val repository = LineRepositoryImpl(service, queries(), backgroundScope)

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
        assertEquals(null, repository.station("KCI-MRI").cached())

        repository.station("KCI-MRI").fetch()
        repository.timetable("KCI-MRI", ServiceDayName.WD).fetch()
        repository.station("KCI-MRI").fetch()
        repository.timetable("KCI-MRI", ServiceDayName.WD).fetch()

        assertEquals(1, stationCalls)
        assertEquals(1, timetableCalls)
        assertEquals("Manggarai", repository.station("KCI-MRI").cached()?.name)
        assertEquals("KCI:B", repository.timetable("KCI-MRI", ServiceDayName.WD).cached()?.single()?.lineKey)
        // Another day type is another board.
        assertEquals(null, repository.timetable("KCI-MRI", ServiceDayName.SAT).cached())
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

        assertTrue(repository.station("KCI-MRI").fetch().isLeft())
        assertEquals(null, repository.station("KCI-MRI").cached())
        fail = false
        assertTrue(repository.station("KCI-MRI").fetch().isRight())

        repository.timetable("KCI-TJ", ServiceDayName.WD).fetch()
        repository.timetable("KCI-TJ", ServiceDayName.WD).fetch()
        assertEquals(2, timetableCalls)
    }

    // Two of Sudirman's live transfers (trimmed), then LRT Jabodebek Halim's EXTERNAL one to KCIC.
    @Test
    fun `transfers decode both kinds`() = runTest {
        val service = FakeCommuteService().apply { transfers = { _, _ -> fixture<List<TransferDto>>("transfers.json") } }

        val transfers = StationRepositoryImpl(service, queries()).transfers("KCI-SUD").fetch().getOrNull()!!

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
    fun `a transfer carries the exits it leaves by and enters through`() = runTest {
        val service = FakeCommuteService().apply { transfers = { _, _ -> fixture<List<TransferDto>>("transfers-exits.json") } }

        val transfers = StationRepositoryImpl(service, queries()).transfers("KCI-SUD").fetch().getOrNull()!!

        assertEquals("B", transfers[0].fromExit)
        assertEquals("D", (transfers[0] as Transfer.Internal).toExit)
        assertEquals("A", transfers[1].fromExit)
    }

    @Test
    fun `exits decode with their signs, the board's entries left as printed`() = runTest {
        var asked: Pair<String, String>? = null
        val service = FakeCommuteService().apply {
            exits = { operator, code ->
                asked = operator to code
                fixture<List<StationExitDto>>("exits.json")
            }
        }

        val exits = StationRepositoryImpl(service, queries()).exits("MRTJ-IST").fetch().getOrNull()!!

        assertEquals("MRTJ" to "IST", asked)
        assertEquals(
            StationExit(
                id = "MRTJ-IST:B",
                ref = "B",
                name = "Jl. Pintu Satu Senayan",
                signs = listOf(
                    ExitSign("Jl. Pintu Satu Senayan", kind = null, stationId = null),
                    ExitSign("Stasiun Palmerah", kind = SignKind.RAIL, stationId = "KCI-PLM"),
                    ExitSign("Halte Gelora Bung Karno", kind = SignKind.BUS, stationId = "TJ-H00201P"),
                ),
                fromOsm = false,
            ),
            exits[0],
        )
        // An exit not yet transcribed: no name, no signs, and OSM's, which has to be credited.
        assertEquals(StationExit("MRTJ-IST:Utara", "Utara", name = null, signs = emptyList(), fromOsm = true), exits[1])
    }

    @Test
    fun `a station's exits are asked once`() = runTest {
        val service = FakeCommuteService().apply { exits = { _, _ -> fixture<List<StationExitDto>>("exits.json") } }
        val repository = StationRepositoryImpl(service, queries())

        repository.exits("MRTJ-IST").fetch()
        repository.exits("MRTJ-IST").fetch()

        assertEquals(1, service.exitsCalls)
    }

    @Test
    fun `a station with no transfers is asked once`() = runTest {
        val service = FakeCommuteService().apply { transfers = { _, _ -> emptyList() } }
        val repository = StationRepositoryImpl(service, queries())

        repository.transfers("KCI-THB").fetch()
        repository.transfers("KCI-THB").fetch()

        assertEquals(1, service.transfersCalls)
        assertEquals(emptyList<Transfer>(), repository.transfers("KCI-THB").cached())
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

        val rows = StationRepositoryImpl(service, queries()).frequencies("TJ-H00001P", ServiceDayName.WD, 8).fetch().getOrNull()!!

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

        val rows = StationRepositoryImpl(service, queries()).frequencies("TJ-H00001P", ServiceDayName.SAT, 8).fetch().getOrNull()!!

        assertEquals(setOf(ServiceDayName.SAT), rows[0].days)
        assertEquals(null, rows[0].serviceHours)
        assertEquals(null, rows[1].days)
    }

    @Test
    fun `frequencies are kept per day, an empty answer included`() = runTest {
        val service = FakeCommuteService().apply { headway = { _, _, _ -> emptyList() } }
        val repository = StationRepositoryImpl(service, queries())

        repository.frequencies("TJ-H00001P", ServiceDayName.WD, 8).fetch()
        repository.frequencies("TJ-H00001P", ServiceDayName.WD, 8).fetch()
        repository.frequencies("TJ-H00001P", ServiceDayName.SAT, 8).fetch()

        assertEquals(2, service.headwayCalls)
        assertEquals(emptyList<Frequency>(), repository.frequencies("TJ-H00001P", ServiceDayName.WD, 8).cached())
        assertEquals(null, repository.frequencies("TJ-H00001P", ServiceDayName.SUN, 8).cached())
    }

    @Test
    fun `frequencies are asked for, and kept, hour by hour`() = runTest {
        val service = FakeCommuteService().apply { headway = { _, _, _ -> fixture<List<HeadwayRow>>("headway-hourly.json") } }
        val repository = StationRepositoryImpl(service, queries())

        val rows = repository.frequencies("TJ-H00001P", ServiceDayName.WD, 8).fetch().getOrNull()!!
        assertEquals(8, service.lastHeadwayHour)
        repository.frequencies("TJ-H00001P", ServiceDayName.WD, 8).fetch()
        repository.frequencies("TJ-H00001P", ServiceDayName.WD, 9).fetch()

        // The hour's measured figure, not the schedule's (186 s).
        assertEquals(332.0, rows[0].headwaySeconds)
        assertEquals(9, service.lastHeadwayHour)
        assertEquals(2, service.headwayCalls)
        assertEquals(null, repository.frequencies("TJ-H00001P", ServiceDayName.WD, 10).cached())
    }

    @Test
    fun `a crowd forecast decodes by hour, an hour without an estimate left empty`() = runTest {
        var asked: Triple<String, String, String>? = null
        val service = FakeCommuteService().apply {
            density = { operator, code, day ->
                asked = Triple(operator, code, day)
                fixture<StationDensity>("density.json")
            }
        }

        val forecast = StationRepositoryImpl(service, queries()).crowding("KCI-MRI", ServiceDayName.WD).fetch().getOrNull()!!

        assertEquals(Triple("KCI", "MRI", "WD"), asked)
        assertEquals(24, forecast.hours.size)
        assertEquals(null, forecast.at(0))
        assertEquals(CrowdRange(CrowdLevel.RAMAI, CrowdLevel.RAMAI), forecast.at(4))
        assertEquals(CrowdRange(CrowdLevel.PADAT, CrowdLevel.SANGAT_PADAT), forecast.at(8))
    }

    @Test
    fun `a crowd forecast is kept per day`() = runTest {
        val service = FakeCommuteService().apply { density = { _, _, _ -> fixture<StationDensity>("density.json") } }
        val repository = StationRepositoryImpl(service, queries())

        repository.crowding("KCI-MRI", ServiceDayName.WD).fetch()
        repository.crowding("KCI-MRI", ServiceDayName.WD).fetch()
        repository.crowding("KCI-MRI", ServiceDayName.SAT).fetch()

        assertEquals(2, service.densityCalls)
    }
}
