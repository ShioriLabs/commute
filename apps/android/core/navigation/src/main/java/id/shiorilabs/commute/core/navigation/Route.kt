package id.shiorilabs.commute.core.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/**
 * Type-safe navigation keys for Navigation 3. Each destination is a `@Serializable` [NavKey];
 * arguments are plain constructor properties (no string routes / `navArgument` / `Uri.encode`).
 * Keys are serializable so the back stack survives configuration changes and process death.
 *
 * Destinations are nested under [Route] (e.g. `Route.Home`) so the package namespace isn't polluted
 * with generic names like `Home`/`Search`.
 */
sealed interface Route : NavKey {

    /** The saved stations list: the root of the back stack. */
    @Serializable
    data object Home : Route

    /** Station search, opened from the home screen's "Mau ke mana?" card. */
    @Serializable
    data object Search : Route

    /**
     * A station's page, opened from search or a saved station's name on the home screen.
     *
     * [title] and [lineKeys] are what the opener already shows of the station, for the page's
     * header to stand on until the station itself loads. Search passes them, so its row's name and
     * roundels have somewhere to land on the page's first frame.
     */
    @Serializable
    data class Station(
        /** `OPERATOR-CODE`, e.g. `KCI-MRI`. */
        val stationId: String,
        val title: String? = null,
        /** `OPERATOR:CODE`. */
        val lineKeys: List<String> = emptyList(),
    ) : Route
}
