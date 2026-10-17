package id.shiorilabs.commute.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Generates the app's Baseline Profile: `./gradlew :app:generateProductionReleaseBaselineProfile`
 * against a connected device on API 33+ (or a rooted 28+). The rules land in
 * `app/src/productionRelease/generated/baselineProfiles/`, AGP packages them into the release build,
 * and ProfileInstaller applies them on first run, so the app's own code is compiled ahead of time
 * rather than interpreted until the JIT catches up.
 *
 * The journey walks what a rider does: cold start, past the welcome screen a fresh install opens
 * on, onto the home feed (flung hard both ways, then pulled to refresh), then search for a station,
 * open it, its crowding legend, timetable and a line page, plan a trip there with OTW (departure
 * chips, a route's detail, saving the route), then open the saved station and the saved route from
 * the feed through their shared-element transitions, and last the settings and the theme switch.
 * It doesn't rely on the device's saved stations; the search path finds its own. Every step past
 * launch is allowed to fail: the content comes from the network, and a profile missing a path is
 * still valid, where a failed generation run is not.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {

    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() {
        val targetPackage = InstrumentationRegistry.getArguments().getString("targetAppId")
            ?: error("targetAppId instrumentation argument was not supplied")

        rule.collect(
            packageName = targetPackage,
            includeInStartupProfile = true,
        ) {
            pressHome()
            startActivityAndWait()

            // A fresh install opens on the welcome screen; later iterations go straight to home.
            runCatching {
                device.wait(Until.hasObject(By.text(WELCOME_CONTINUE)), WELCOME_TIMEOUT_MS)
                device.findObject(By.text(WELCOME_CONTINUE))?.click()
                device.waitForIdle()
            }

            // Pin a handful of stations first, so the feed is the full one a rider scrolls and taps.
            seedSavedStations()

            // The feed loads after launch; fling it hard once it does.
            scrollFeedFast()

            // Search: the rail card's morph, typing, ranking, and opening a result.
            runCatching {
                device.findObject(By.desc(SEARCH_CARD_DESCRIPTION))?.click() ?: return@runCatching
                device.wait(Until.hasObject(By.clazz(EDIT_TEXT_CLASS)), CONTENT_TIMEOUT_MS)
                device.findObject(By.clazz(EDIT_TEXT_CLASS))?.text = SEARCH_QUERY
                device.wait(Until.hasObject(By.text(SEARCH_RESULT)), CONTENT_TIMEOUT_MS)
                device.findObject(By.text(SEARCH_RESULT))?.click() ?: return@runCatching
                // The badge, buttons and line badges sit at the top, so scroll the page last.
                openCrowdLegend()
                openTimetable()
                openLine()
                planTripHere()
                scrollStationPage()
                backToHome()
            }

            // A saved station and a saved route from the feed: their pages flying in.
            openStationFromFeed()
            openRouteFromFeed()

            openSettings()
        }
    }

    /**
     * Saves each of [SEED_STATIONS] from its station page, the way a rider pins one, so the feed
     * has real rows whatever the device held before. A station already saved shows the unsave button
     * instead and is left alone, which keeps later iterations from toggling it off.
     */
    private fun MacrobenchmarkScope.seedSavedStations() {
        for (station in SEED_STATIONS) {
            runCatching {
                device.wait(Until.hasObject(By.desc(SEARCH_CARD_DESCRIPTION)), CONTENT_TIMEOUT_MS)
                device.findObject(By.desc(SEARCH_CARD_DESCRIPTION))?.click() ?: return@runCatching
                device.wait(Until.hasObject(By.clazz(EDIT_TEXT_CLASS)), CONTENT_TIMEOUT_MS)
                // Typed in lower case, so the field never matches the result it is looking for.
                device.findObject(By.clazz(EDIT_TEXT_CLASS))?.text = station.lowercase()
                device.wait(Until.hasObject(By.textStartsWith(station)), CONTENT_TIMEOUT_MS)
                device.findObject(By.textStartsWith(station))?.click() ?: return@runCatching
                device.wait(Until.hasObject(By.desc(SAVE_STATION_DESCRIPTION)), CONTENT_TIMEOUT_MS)
                device.findObject(By.desc(SAVE_STATION_DESCRIPTION))?.click()
                device.waitForIdle()
                backToHome()
            }
        }
    }

    /**
     * Backs out of whatever is open until the rail's search card shows. A station opened from search
     * takes one back to return to the search page, and another only to drop its keyboard, so the
     * count differs by screen; looking for the card is what tells home has been reached.
     */
    private fun MacrobenchmarkScope.backToHome() {
        repeat(BACK_TO_HOME_LIMIT) {
            if (device.hasObject(By.desc(SEARCH_CARD_DESCRIPTION))) return
            device.pressBack()
            device.waitForIdle()
        }
    }

    /**
     * The feed under load: back-to-back flings with no settling between them, so rows compose while
     * the list is still moving, then a pull from the top for the refresh. Nothing saved is fine.
     */
    private fun MacrobenchmarkScope.scrollFeedFast() {
        runCatching {
            device.wait(Until.hasObject(By.scrollable(true)), CONTENT_TIMEOUT_MS)
            val feed = device.findObject(By.scrollable(true)) ?: return@runCatching
            feed.setGestureMargin(device.displayWidth / 5)
            val speed = device.displayHeight * FAST_FLING_FACTOR
            repeat(FAST_FLINGS) { feed.fling(Direction.DOWN, speed) }
            device.waitForIdle()
            repeat(FAST_FLINGS) { feed.fling(Direction.UP, speed) }
            device.waitForIdle()
            device.swipe(
                device.displayWidth / 2, device.displayHeight / 4,
                device.displayWidth / 2, device.displayHeight * 3 / 4,
                REFRESH_SWIPE_STEPS,
            )
            device.waitForIdle()
        }
    }

    /** A saved station's title on the feed, opened and scrolled, then back. */
    private fun MacrobenchmarkScope.openStationFromFeed() {
        runCatching {
            device.wait(Until.hasObject(By.textStartsWith(SAVED_TITLE_PREFIX)), CONTENT_TIMEOUT_MS)
            device.findObject(By.textStartsWith(SAVED_TITLE_PREFIX))?.click() ?: return@runCatching
            scrollStationPage()
            device.pressBack()
            device.waitForIdle()
        }
    }

    /** The route the OTW step saved, opened from the feed through its departures. */
    private fun MacrobenchmarkScope.openRouteFromFeed() {
        runCatching {
            device.wait(Until.hasObject(By.descStartsWith(SAVED_ROUTE_DESCRIPTION)), CONTENT_TIMEOUT_MS)
            device.findObject(By.descStartsWith(SAVED_ROUTE_DESCRIPTION))?.click() ?: return@runCatching
            scrollStationPage()
            device.pressBack()
            device.waitForIdle()
        }
    }

    /** The crowd badge's legend sheet, opened and closed. */
    private fun MacrobenchmarkScope.openCrowdLegend() {
        runCatching {
            device.findObject(By.descStartsWith(CROWD_BADGE_DESCRIPTION))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.desc(CROWD_LEGEND_CLOSE)), CONTENT_TIMEOUT_MS)
            device.findObject(By.desc(CROWD_LEGEND_CLOSE))?.click()
            device.waitForIdle()
        }
    }

    /** The full timetable, its line filter sheet and a scroll down the departures. */
    private fun MacrobenchmarkScope.openTimetable() {
        runCatching {
            device.findObject(By.text(TIMETABLE_BUTTON))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.textStartsWith(TIMETABLE_FILTER)), CONTENT_TIMEOUT_MS)
            device.findObject(By.textStartsWith(TIMETABLE_FILTER))?.click()
            device.waitForIdle()
            device.pressBack()
            device.waitForIdle()
            scrollStationPage()
            device.pressBack()
            device.waitForIdle()
        }
    }

    /** A line badge on the station page opens the line, whose other branch is then shown. */
    private fun MacrobenchmarkScope.openLine() {
        runCatching {
            device.findObject(By.descStartsWith(LINE_BADGE_DESCRIPTION))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.scrollable(true)), CONTENT_TIMEOUT_MS)
            device.findObject(By.descStartsWith(LINE_BRANCH_DESCRIPTION))?.click()
            device.waitForIdle()
            scrollStationPage()
            device.pressBack()
            device.waitForIdle()
        }
    }

    /** Settings from the rail, the theme switched to dark and back, and the saved list. */
    private fun MacrobenchmarkScope.openSettings() {
        runCatching {
            device.wait(Until.hasObject(By.desc(SETTINGS_CARD_DESCRIPTION)), CONTENT_TIMEOUT_MS)
            device.findObject(By.desc(SETTINGS_CARD_DESCRIPTION))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.text(SETTINGS_THEME)), CONTENT_TIMEOUT_MS)
            runCatching {
                device.findObject(By.text(SETTINGS_THEME))?.click() ?: return@runCatching
                device.wait(Until.hasObject(By.text(THEME_DARK)), CONTENT_TIMEOUT_MS)
                device.findObject(By.text(THEME_DARK))?.click()
                device.waitForIdle()
                // Back to the light default, so the next iteration starts the way this one did.
                device.findObject(By.text(THEME_LIGHT))?.click()
                device.waitForIdle()
                device.pressBack()
                device.waitForIdle()
            }
            runCatching {
                device.findObject(By.text(SETTINGS_SAVED))?.click() ?: return@runCatching
                device.waitForIdle()
                device.pressBack()
                device.waitForIdle()
            }
            device.pressBack()
            device.waitForIdle()
        }
    }

    /**
     * OTW from the open station page: its button opens the origin picker, a typed origin brings the
     * route options, whose chips and first option are exercised, and back returns to the station.
     * Allowed to fail like every step past launch.
     */
    private fun MacrobenchmarkScope.planTripHere() {
        runCatching {
            device.wait(Until.hasObject(By.text(OTW_BUTTON)), CONTENT_TIMEOUT_MS)
            device.findObject(By.text(OTW_BUTTON))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.clazz(EDIT_TEXT_CLASS)), CONTENT_TIMEOUT_MS)
            device.findObject(By.clazz(EDIT_TEXT_CLASS))?.text = OTW_ORIGIN_QUERY
            device.wait(Until.hasObject(By.textStartsWith(OTW_ORIGIN)), CONTENT_TIMEOUT_MS)
            device.findObject(By.textStartsWith(OTW_ORIGIN))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.textContains(ROUTE_OPTION_TIMES)), CONTENT_TIMEOUT_MS)
            openRouteDetail()
            device.pressBack()
            device.waitForIdle()
        }
    }

    /** The first route option opened into its detail: chips swiped, scrolled, saved to the feed. */
    private fun MacrobenchmarkScope.openRouteDetail() {
        runCatching {
            device.findObject(By.textContains(ROUTE_OPTION_TIMES))?.click() ?: return@runCatching
            device.wait(Until.hasObject(By.textStartsWith(DEPARTURE_CHIP_ARRIVES)), CONTENT_TIMEOUT_MS)
            swipeDepartureChips()
            scrollStationPage()
            // Saved here so the feed has a route to open from.
            device.findObject(By.desc(SAVE_ROUTE_DESCRIPTION))?.click()
            device.waitForIdle()
            device.pressBack()
            device.waitForIdle()
        }
    }

    /** The departure chips run off the screen: swipe them both ways and pick another train. */
    private fun MacrobenchmarkScope.swipeDepartureChips() {
        runCatching {
            val y = device.findObject(By.textStartsWith(DEPARTURE_CHIP_ARRIVES))?.visibleCenter?.y
                ?: return@runCatching
            val width = device.displayWidth
            device.swipe(width * 9 / 10, y, width / 10, y, CHIP_SWIPE_STEPS)
            device.waitForIdle()
            device.swipe(width / 10, y, width * 9 / 10, y, CHIP_SWIPE_STEPS)
            device.waitForIdle()
            device.findObject(By.textStartsWith(DEPARTURE_CHIP_ARRIVES))?.click()
            device.waitForIdle()
        }
    }

    private fun MacrobenchmarkScope.scrollStationPage() {
        device.wait(Until.hasObject(By.scrollable(true)), CONTENT_TIMEOUT_MS)
        repeat(STATION_SCROLL_PASSES) {
            val page = device.findObject(By.scrollable(true)) ?: return
            page.setGestureMargin(device.displayWidth / 5)
            page.fling(Direction.DOWN)
            device.waitForIdle()
        }
    }

    private companion object {
        /** How long to wait for a screen's content to appear. */
        const val CONTENT_TIMEOUT_MS = 5_000L

        /** The welcome screen's button (onboarding_continue), and how long to look for it. */
        const val WELCOME_CONTINUE = "Lanjut"
        const val WELCOME_TIMEOUT_MS = 2_000L

        /** Fling passes down a station page: enough to reach its facilities. */
        const val STATION_SCROLL_PASSES = 2

        /** Home feed flings: how many in a row, their speed in screen heights per second, and the pull's steps. */
        const val FAST_FLINGS = 3
        const val FAST_FLING_FACTOR = 4
        const val REFRESH_SWIPE_STEPS = 20

        /** The most backs from a station opened through search to the feed: station, keyboard, search. */
        const val BACK_TO_HOME_LIMIT = 4

        /** The home rail's search card, as it is read out (saved_nav_search_description). */
        const val SEARCH_CARD_DESCRIPTION = "Cari stasiun, rute, dan tarif"

        /** What Compose's text field reports itself as. */
        const val EDIT_TEXT_CLASS = "android.widget.EditText"

        const val SEARCH_QUERY = "manggarai"
        const val SEARCH_RESULT = "Manggarai"

        /** The station page's OTW button (station_otw), and an origin to plan from to Manggarai. */
        const val OTW_BUTTON = "OTW Ke Sini"
        const val OTW_ORIGIN_QUERY = "sudirman"
        const val OTW_ORIGIN = "Sudirman"

        /** A route option's departure and arrival times, "15.27 → 15.37", on the card for the one route. */
        const val ROUTE_OPTION_TIMES = "→"

        /** A departure chip on the route's detail, under its time: "tiba 15.45" (journey_pick_arrives). */
        const val DEPARTURE_CHIP_ARRIVES = "tiba "
        const val CHIP_SWIPE_STEPS = 15

        /** The route detail's save button (journey_save_route). */
        const val SAVE_ROUTE_DESCRIPTION = "Simpan rute ini ke beranda"

        /** Stations pinned before the feed is walked: a spread of KRL, MRT and TransJakarta names. */
        val SEED_STATIONS = listOf("Manggarai", "Sudirman", "Tanah Abang", "Bogor", "Bundaran HI")

        /** The station page's save button (station_save_description). */
        const val SAVE_STATION_DESCRIPTION = "Simpan stasiun ini ke favorit"

        /** A saved station's title on the feed: its name, the station the run pinned from search. */
        const val SAVED_TITLE_PREFIX = SEARCH_RESULT

        /** A saved route's row on the feed (saved_route_title_description: "Rute A ke B"). */
        const val SAVED_ROUTE_DESCRIPTION = "Rute "

        /** The crowd badge (crowd_badge_description) and its legend's close button (crowd_legend_close). */
        const val CROWD_BADGE_DESCRIPTION = "Perkiraan Keramaian"
        const val CROWD_LEGEND_CLOSE = "Tutup arti ikon keramaian"

        /** The station page's timetable button (station_full_timetable) and its filter (station_timetable_filter). */
        const val TIMETABLE_BUTTON = "Jadwal Lengkap"
        const val TIMETABLE_FILTER = "Filter Jalur"

        /** A line badge (line_badge_description) and a branch toggle (line_branch_description). */
        const val LINE_BADGE_DESCRIPTION = "Lihat "
        const val LINE_BRANCH_DESCRIPTION = "Tampilkan rute arah"

        /** The rail's settings card (saved_nav_settings_description) and the pages under it. */
        const val SETTINGS_CARD_DESCRIPTION = "Pengaturan aplikasi"
        const val SETTINGS_THEME = "Tema"
        const val SETTINGS_SAVED = "Stasiun & Rute Disimpan"
        const val THEME_DARK = "Gelap"
        const val THEME_LIGHT = "Terang"
    }
}
