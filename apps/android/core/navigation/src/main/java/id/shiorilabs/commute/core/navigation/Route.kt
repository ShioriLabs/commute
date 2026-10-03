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

    /**
     * A station's whole timetable for the day, opened from its page's "Jadwal Lengkap". [title] is
     * the station's name as the page already shows it, for the header's first frame.
     */
    @Serializable
    data class StationTimetable(
        /** `OPERATOR-CODE`, e.g. `KCI-MRI`. */
        val stationId: String,
        val title: String? = null,
    ) : Route

    /**
     * OTW: the routes and fares between two stations, the web's `/fare`. Opened from a station's
     * "OTW Ke Sini" with only [toId], which opens the origin picker, from search's OTW tab with
     * both, and from a shared `/fare` link.
     *
     * The rest is what a shared link carries. [journeyKey] names the route the sender was looking
     * at, opened straight on its detail if it still runs; the criteria are the link's raw query
     * params, which beat the rider's stored settings for this visit only.
     */
    @Serializable
    data class Journey(
        /** `OPERATOR-CODE`. */
        val fromId: String? = null,
        val toId: String? = null,
        val journeyKey: String? = null,
        /**
         * Which boarding of [journeyKey]'s route, as `HHmm` WIB: a link's `?jt=`, which home's saved
         * pairs add because their rows of one route share a key.
         */
        val boardingClock: String? = null,
        val paymentMethod: String? = null,
        val at: String? = null,
        val modes: String? = null,
        val walking: String? = null,
    ) : Route

    /** Settings, opened from the home screen's "Pengaturan" card. */
    @Serializable
    data object Settings : Route

    /** Reorder and unpin the stations on the home screen. */
    @Serializable
    data object SettingsSavedStations : Route

    /** What the app keeps on the device, and clearing it. */
    @Serializable
    data object SettingsManageData : Route

    /** The legal documents and attributions, each a page below. */
    @Serializable
    data object SettingsLegal : Route

    @Serializable
    data object SettingsPrivacyPolicy : Route

    @Serializable
    data object SettingsTerms : Route

    @Serializable
    data object SettingsDataAttributions : Route

    @Serializable
    data object SettingsOssAttributions : Route

    @Serializable
    data object SettingsCreativeAssets : Route

    /** Sharing Commute, and supporting it on Saweria. */
    @Serializable
    data object SettingsSupport : Route

    @Serializable
    data object SettingsAbout : Route
}
