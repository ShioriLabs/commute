package id.shiorilabs.commute.feature.card.reader

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JapanIcLinesTest {
    private val csv = """
        area,line,company,line_name
        0,1,東日本旅客鉄道,東海道線
        1,1,どこか鉄道,どこか線
        0,2D,東日本旅客鉄道,
        0,0,北海道旅客鉄道,-
    """.trimIndent()

    private val lines = JapanIcLines { csv.byteInputStream() }

    @Test
    fun `finds a line by its code`() {
        assertEquals(JapanLine("東日本旅客鉄道", "東海道線"), lines[0x01])
    }

    @Test
    fun `a code that covers several lines has only its company`() {
        assertEquals(JapanLine("東日本旅客鉄道", null), lines[0x2D])
    }

    @Test
    fun `a dash is no name`() {
        assertEquals(JapanLine("北海道旅客鉄道", null), lines[0x00])
    }

    @Test
    fun `a code the table lacks is unnamed`() {
        assertNull(lines[0x99])
    }

    @Test
    fun `the shipped table says JR East ran the PASMO's rides`() {
        // The rides JAPAN_IC.md checked the dump against, all on line 2D.
        val shipped = JapanIcLines { File("src/main/assets/japan_ic/lines.csv").inputStream() }

        assertEquals(JapanLine("東日本旅客鉄道", null), shipped[0x2D])
    }
}
