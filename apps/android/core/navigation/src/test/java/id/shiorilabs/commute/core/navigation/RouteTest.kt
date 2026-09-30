package id.shiorilabs.commute.core.navigation

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class RouteTest {

    @Test
    fun `Home survives a serialization round-trip`() {
        // The back stack persists keys across process death, so every key must round-trip.
        val encoded = Json.encodeToString(Route.Home)

        assertEquals(Route.Home, Json.decodeFromString<Route.Home>(encoded))
    }
}
