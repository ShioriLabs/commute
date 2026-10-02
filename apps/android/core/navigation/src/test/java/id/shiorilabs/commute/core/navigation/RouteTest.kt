package id.shiorilabs.commute.core.navigation

import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import org.junit.Assert.assertEquals
import org.junit.Test

class RouteTest {

    @Test
    fun `Home survives a serialization round-trip`() {
        // The back stack persists keys across process death, so every key must round-trip.
        val encoded = Json.encodeToString(Route.Home)

        assertEquals(Route.Home, Json.decodeFromString<Route.Home>(encoded))
    }

    @Test
    fun `Station survives a serialization round-trip with its id`() {
        val route = Route.Station("KCI-MRI", title = "Manggarai", lineKeys = listOf("KCI:B", "KCI:C"))
        val encoded = Json.encodeToString(route)

        assertEquals(route, Json.decodeFromString<Route.Station>(encoded))
    }

    @Test
    fun `the settings pages survive a serialization round-trip`() {
        val routes: List<Route> = listOf(
            Route.Settings,
            Route.SettingsSavedStations,
            Route.SettingsManageData,
            Route.SettingsLegal,
            Route.SettingsPrivacyPolicy,
            Route.SettingsTerms,
            Route.SettingsDataAttributions,
            Route.SettingsOssAttributions,
            Route.SettingsCreativeAssets,
            Route.SettingsSupport,
            Route.SettingsAbout,
        )

        // Route itself isn't polymorphic-serializable; each key goes through its own serializer.
        routes.forEach { route ->
            val serializer = serializer(route::class.java)
            assertEquals(route, Json.decodeFromString(serializer, Json.encodeToString(serializer, route)))
        }
    }
}
