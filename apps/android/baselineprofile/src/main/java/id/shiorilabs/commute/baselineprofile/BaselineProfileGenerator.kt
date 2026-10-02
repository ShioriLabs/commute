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
 * The journey walks what a rider does: cold start onto the home feed, then search for a station and
 * open it, then open a saved station from the feed through its shared-element transition. It doesn't
 * rely on the device's saved stations; the search path finds its own. Every step past launch is
 * allowed to fail: the content comes from the network, and a profile missing a path is still valid,
 * where a failed generation run is not.
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

            // The feed loads after launch; scroll it once it does, if there is anything saved.
            runCatching {
                device.wait(Until.hasObject(By.scrollable(true)), CONTENT_TIMEOUT_MS)
                val feed = device.findObject(By.scrollable(true)) ?: return@runCatching
                feed.setGestureMargin(device.displayWidth / 5)
                feed.fling(Direction.DOWN)
                device.waitForIdle()
                feed.fling(Direction.UP)
                device.waitForIdle()
            }

            // Search: the rail card's morph, typing, ranking, and opening a result.
            runCatching {
                device.findObject(By.desc(SEARCH_CARD_DESCRIPTION))?.click() ?: return@runCatching
                device.wait(Until.hasObject(By.clazz(EDIT_TEXT_CLASS)), CONTENT_TIMEOUT_MS)
                device.findObject(By.clazz(EDIT_TEXT_CLASS))?.text = SEARCH_QUERY
                device.wait(Until.hasObject(By.text(SEARCH_RESULT)), CONTENT_TIMEOUT_MS)
                device.findObject(By.text(SEARCH_RESULT))?.click() ?: return@runCatching
                scrollStationPage()
                device.pressBack()
                device.waitForIdle()
                device.pressBack()
                device.waitForIdle()
            }

            // A saved station from the feed: the title, cards and roundels flying into its page.
            runCatching {
                device.wait(Until.hasObject(By.textStartsWith(SAVED_TITLE_PREFIX)), CONTENT_TIMEOUT_MS)
                device.findObject(By.textStartsWith(SAVED_TITLE_PREFIX))?.click() ?: return@runCatching
                scrollStationPage()
                device.pressBack()
                device.waitForIdle()
            }
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

        /** Fling passes down a station page: enough to reach its facilities. */
        const val STATION_SCROLL_PASSES = 2

        /** The home rail's search card, as it is read out (saved_nav_search_description). */
        const val SEARCH_CARD_DESCRIPTION = "Cari stasiun, rute, dan tarif"

        /** What Compose's text field reports itself as. */
        const val EDIT_TEXT_CLASS = "android.widget.EditText"

        const val SEARCH_QUERY = "manggarai"
        const val SEARCH_RESULT = "Manggarai"

        /** A saved station's title on the feed (station_title): "Stasiun Manggarai". */
        const val SAVED_TITLE_PREFIX = "Stasiun"
    }
}
