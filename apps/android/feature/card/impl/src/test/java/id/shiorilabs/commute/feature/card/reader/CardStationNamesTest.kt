package id.shiorilabs.commute.feature.card.reader

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.station.domain.Station
import java.io.File
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CardStationNamesTest {

    private val snapshot = """{ "MRTJ-BHI": "Bundaran HI Bank DKI", "KCI-SUD": "Sudirman" }"""

    private fun station(id: String, name: String) = Station(id = id, name = name, operator = id.substringBefore('-'), code = id.substringAfter('-'), lineKeys = emptyList())

    private class Directory(
        private val held: List<Station>? = null,
        private val fetched: Either<Failure, List<Station>> = Failure.Network.NoConnection().left(),
    ) : StationDirectory {
        override suspend fun all() = fetched
        override suspend fun stored() = held
    }

    private fun names(directory: StationDirectory) = CardStationNames(directory) { snapshot.byteInputStream() }

    @Test
    fun `a phone that has never fetched the stations names them from the snapshot`() = runTest {
        val names = names(Directory()).names.toList()

        assertEquals(listOf(mapOf("MRTJ-BHI" to "Bundaran HI Bank DKI", "KCI-SUD" to "Sudirman")), names)
    }

    @Test
    fun `the held directory's name beats the snapshot's`() = runTest {
        val names = names(Directory(held = listOf(station("MRTJ-BHI", "Bundaran HI Bank Jakarta")))).names.last()

        assertEquals("Bundaran HI Bank Jakarta", names["MRTJ-BHI"])
        assertEquals("Sudirman", names["KCI-SUD"])
    }

    @Test
    fun `a fetched name beats the held one`() = runTest {
        val directory = Directory(
            held = listOf(station("MRTJ-BHI", "Bundaran HI Bank Jakarta")),
            fetched = listOf(station("MRTJ-BHI", "Bundaran HI Baru")).right(),
        )

        assertEquals("Bundaran HI Baru", names(directory).names.last()["MRTJ-BHI"])
    }

    @Test
    fun `the snapshot shows before the directory answers`() = runTest {
        val names = names(Directory(held = listOf(station("MRTJ-BHI", "Bundaran HI Bank Jakarta")))).names.toList()

        assertEquals("Bundaran HI Bank DKI", names.first()["MRTJ-BHI"])
    }

    @Test
    fun `a failed fetch keeps the names it had`() = runTest {
        val names = names(Directory(held = listOf(station("KCI-JAKK", "Jakarta Kota")))).names.toList()

        assertEquals(2, names.size)
        assertEquals("Jakarta Kota", names.last()["KCI-JAKK"])
    }

    @Test
    fun `the shipped snapshot names every station the KMT reader knows`() = runTest {
        val shipped = CardStationNames(Directory()) { File("src/main/assets/$CARD_STATION_NAMES_ASSET").inputStream() }
        val ids = KmtReader.KRL_STATIONS.values + KmtReader.LRT_STATIONS.values + KmtReader.MRT_STATIONS.values

        val names = shipped.names.last()

        val missing = ids.filterNot { it in names }
        assertTrue("Not in the snapshot: $missing", missing.isEmpty())
    }
}
