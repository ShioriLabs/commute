package id.shiorilabs.commute.feature.station.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class LineOrderTest {

    @Test
    fun `TJ corridors sort by number then suffix, with the express variant inside its group`() {
        val keys = listOf("TJ:13", "TJ:6B", "TJ:L13E", "TJ:6", "TJ:13E", "TJ:6A", "TJ:1")

        assertEquals(
            listOf("TJ:1", "TJ:6", "TJ:6A", "TJ:6B", "TJ:13", "TJ:13E", "TJ:L13E"),
            sortLineKeysForDisplay(keys, "TJ"),
        )
    }

    @Test
    fun `TJ hides the fair shuttles and puts other codes without a number last`() {
        val keys = listOf("TJ:PRJ2", "TJ:JAK10", "TJ:2", "TJ:PRJ3")

        assertEquals(listOf("TJ:2", "TJ:JAK10"), sortLineKeysForDisplay(keys, "TJ"))
    }

    @Test
    fun `other operators keep the order the API sent`() {
        val keys = listOf("KCI:C", "KCI:B", "KCI:A")

        assertEquals(keys, sortLineKeysForDisplay(keys, "KCI"))
    }

    @Test
    fun `empty keys are dropped`() {
        assertEquals(listOf("KCI:B"), sortLineKeysForDisplay(listOf("", "KCI:B"), "KCI"))
    }

    @Test
    fun `a directional halte loses its Arah suffix, in any case`() {
        assertEquals("Kali Grogol", directionalBaseName("Kali Grogol Arah Utara"))
        assertEquals("Kali Grogol", directionalBaseName("Kali Grogol arah selatan"))
    }

    @Test
    fun `a name that only mentions Arah elsewhere is left alone`() {
        assertEquals("Arah Baru", directionalBaseName("Arah Baru"))
        assertEquals("Manggarai", directionalBaseName("Manggarai"))
    }
}
