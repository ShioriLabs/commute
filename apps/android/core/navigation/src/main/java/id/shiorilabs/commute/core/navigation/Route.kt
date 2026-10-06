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
     * A hub's page, the web's `/hubs/{slug}`: the stations that count as one place, each opening
     * its own page. Opened from search. [title] is the name the opener shows, for the header's
     * first frame.
     */
    @Serializable
    data class Hub(
        /** The hub's URL key, e.g. `dukuh-atas`. */
        val slug: String,
        val title: String? = null,
    ) : Route

    /**
     * A line's page, the web's `/lines/{operator}/{lineCode}`: its stations in order along the
     * line, with its branches. Opened from search, a line card's header on a station's page, a
     * transfer's roundels and another line's page.
     *
     * [title] and [colorCode] are the name and roundel colour the opener shows, for the header's
     * first frame.
     */
    @Serializable
    data class Line(
        /** e.g. `KCI`. */
        val operator: String,
        /** e.g. `B`. */
        val lineCode: String,
        val title: String? = null,
        /** `#RRGGBB`. */
        val colorCode: String? = null,
    ) : Route

    /**
     * Search opened on its OTW tab with the pair already in: a station's "OTW Ke Sini" brings only
     * [toId], which opens the origin picker; a saved pair's title on home and a shared `/fare` link
     * without a journey bring both. The tab shows for this visit only; the stored choice is untouched.
     *
     * The criteria are a shared link's raw query params, which beat the rider's stored settings for
     * this visit only.
     */
    @Serializable
    data class Otw(
        /** `OPERATOR-CODE`. */
        val fromId: String? = null,
        val toId: String? = null,
        val paymentMethod: String? = null,
        val at: String? = null,
        val modes: String? = null,
        val walking: String? = null,
    ) : Route

    /**
     * One journey between two stations, in full: opened from an OTW option, a saved pair's row on
     * home and a shared `/fare` link that names a journey.
     *
     * [journeyKey] names the route, and [boardingClock] which of its boardings; the page asks for the
     * pair again under the criteria and finds the journey there. The criteria are raw link params
     * laid over the rider's stored settings, which the app's own openers spell out in full so the
     * page asks exactly what the opener showed.
     */
    @Serializable
    data class Trip(
        /** `OPERATOR-CODE`. */
        val fromId: String,
        val toId: String,
        val journeyKey: String,
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

    /**
     * The trip being followed, live: opened from the trip notification, the trip bar over every
     * screen and the trip page. Reads the stored trip, so it opens offline.
     */
    @Serializable
    data object ActiveTrip : Route

    /** Settings, opened from the home screen's "Pengaturan" card. */
    @Serializable
    data object Settings : Route

    /** Reorder and unpin the stations on the home screen. */
    @Serializable
    data object SettingsSavedStations : Route

    /** What the app keeps on the device, and clearing it. */
    @Serializable
    data object SettingsManageData : Route

    /** What the app may use the rider's location for. */
    @Serializable
    data object SettingsLocation : Route

    /** How the trip page shows a trip under way. */
    @Serializable
    data object SettingsOtw : Route

    /** Switches for trying the app out: debug builds, or after seven taps on the version. */
    @Serializable
    data object SettingsExperimental : Route

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
