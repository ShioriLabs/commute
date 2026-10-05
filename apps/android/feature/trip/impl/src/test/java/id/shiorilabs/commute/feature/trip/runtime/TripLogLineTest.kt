package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.PositionSource
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class TripLogLineTest {

    @Test
    fun `an event is one line of JSON, its facts as plain values`() {
        val line = line(
            "2026-10-05T10:25:22+07:00",
            "fix",
            mapOf("lat" to -6.2024, "acc" to 5f, "src" to PositionSource.CONFIRMED, "walking" to false, "onward" to null),
        )

        assertEquals(1, line.count { it == '\n' })
        assertEquals(true, line.endsWith("\n"))
        val json = Json.parseToJsonElement(line).jsonObject
        assertEquals("2026-10-05T10:25:22+07:00", json.getValue("t").jsonPrimitive.content)
        assertEquals("fix", json.getValue("ev").jsonPrimitive.content)
        assertEquals(-6.2024, json.getValue("lat").jsonPrimitive.double, 0.0)
        assertEquals(5.0, json.getValue("acc").jsonPrimitive.double, 0.0)
        assertEquals("CONFIRMED", json.getValue("src").jsonPrimitive.content)
        assertEquals(false, json.getValue("walking").jsonPrimitive.boolean)
        assertEquals(JsonNull, json.getValue("onward"))
    }
}
