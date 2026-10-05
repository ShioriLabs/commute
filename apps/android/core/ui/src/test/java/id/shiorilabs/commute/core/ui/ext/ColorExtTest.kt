package id.shiorilabs.commute.core.ui.ext

import androidx.compose.ui.graphics.Color
import id.shiorilabs.commute.core.ui.theme.Slate400
import org.junit.Assert.assertEquals
import org.junit.Test

class ColorExtTest {

    @Test
    fun `parses six-digit hex with or without the hash`() {
        assertEquals(Color(0xFF25B8EB), parseHexColor("#25B8EB"))
        assertEquals(Color(0xFF25B8EB), parseHexColor("25b8eb"))
    }

    @Test
    fun `expands three-digit hex`() {
        assertEquals(Color(0xFFFF0000), parseHexColor("#F00"))
    }

    @Test
    fun `falls back on malformed input`() {
        assertEquals(Color.Magenta, parseHexColor("#12345", fallback = Color.Magenta))
        assertEquals(Color.Magenta, parseHexColor("#GGGGGG", fallback = Color.Magenta))
    }

    @Test
    fun `a line without a usable colour is slate`() {
        assertEquals(Color(0xFF25B8EB), lineColorOf("#25B8EB"))
        assertEquals(Slate400, lineColorOf(null))
        assertEquals(Slate400, lineColorOf("#GGGGGG"))
    }

    // Same answers as utils/colors.ts getForegroundColor on the web.
    @Test
    fun `dark lines take white text and pale ones take dark text`() {
        assertEquals(Foreground.LIGHT, parseHexColor("#EE3D43").foreground())
        assertEquals(Foreground.LIGHT, parseHexColor("#25B8EB").foreground())
        assertEquals(Foreground.DARK, parseHexColor("#FFD200").foreground())
        assertEquals(Foreground.DARK, Color.White.foreground())
    }

    // getTintFromColor("#25B8EB", 0.2, 'light') on the web is #D3F1FB.
    @Test
    fun `tint washes towards white like the web`() {
        assertEquals(parseHexColor("#D3F1FB"), parseHexColor("#25B8EB").tint(0.2f))
    }
}
