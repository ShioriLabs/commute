package id.shiorilabs.commute.feature.station.data

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.impl.LineRepositoryImpl
import id.shiorilabs.commute.feature.station.data.impl.StationRepositoryImpl
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

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

    @Test
    fun `a station decodes even with values its enums never had`() = runTest {
        // The fixture carries an amenity type and a region code the API has not shipped (yet).
        val service = FakeCommuteService().apply { station = { _, _ -> fixture<Station>("station.json") } }

        val station = StationRepositoryImpl(service).station("KCI-MRI").getOrNull()!!

        assertEquals("KCI-MRI", station.id)
        assertEquals("Manggarai", station.name)
        assertEquals(listOf("KCI:A", "KCI:B", "KCI:C"), station.lineKeys)
    }

    @Test
    fun `a station carries its amenities and coordinates for the station page`() = runTest {
        val service = FakeCommuteService().apply { station = { _, _ -> fixture<Station>("station.json") } }

        val station = StationRepositoryImpl(service).station("KCI-MRI").getOrNull()!!

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

        StationRepositoryImpl(service).timetable("KCI-MRI", ServiceDayName.SAT)

        assertEquals(Triple("KCI", "MRI", "SAT"), asked)
    }

    @Test
    fun `departure times become minutes since midnight`() = runTest {
        val service = FakeCommuteService().apply {
            groupedTimetable = { _, _, _ -> fixture<List<GroupedTimetable>>("timetable.json") }
        }

        val line = StationRepositoryImpl(service).timetable("KCI-MRI", ServiceDayName.WD).getOrNull()!!.single()

        assertEquals("KCI:B", line.lineKey)
        val group = line.groups.single()
        assertEquals(listOf("Depok", "Citayam", "Bogor"), group.label)
        assertEquals("11/12", group.platformCode)
        assertEquals(Departure("1470", 15), group.destinations.first().departures.first())
    }

    @Test
    fun `the line dictionary is keyed by operator and code, and fetched once`() = runTest {
        val service = FakeCommuteService().apply { operators = { fixture<List<OperatorWithLines>>("operators.json") } }
        val repository = LineRepositoryImpl(service)

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
        val repository = LineRepositoryImpl(service)

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
        val repository = StationRepositoryImpl(service)
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
        val repository = StationRepositoryImpl(service)

        assertTrue(repository.station("KCI-MRI").isLeft())
        assertEquals(null, repository.cachedStation("KCI-MRI"))
        fail = false
        assertTrue(repository.station("KCI-MRI").isRight())

        repository.timetable("KCI-TJ", ServiceDayName.WD)
        repository.timetable("KCI-TJ", ServiceDayName.WD)
        assertEquals(2, timetableCalls)
    }
}
