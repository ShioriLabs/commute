package id.shiorilabs.commute.baselineprofile.wear

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Generates the watch app's Baseline Profile: run with only the watch selected (it's the same
 * package as the phone app),
 * `ANDROID_SERIAL=<watch> ./gradlew :wear:generateProductionReleaseBaselineProfile`, on Wear OS 4
 * (API 33) or later. The rules land in `wear/src/productionRelease/generated/baselineProfiles/`,
 * and ProfileInstaller applies them on first run.
 *
 * The journey is a cold start onto whichever screen the phone's trip makes it, then a scroll down
 * and back: "Belom OTW nih" with no trip, the trip itself while one runs. A profile from either is
 * valid, and the screen that isn't up is simply missing from it; run it once with a trip going to
 * take in the trip screen too.
 */
@RunWith(AndroidJUnit4::class)
class WearBaselineProfileGenerator {

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

            // The phone's trip comes over the Data Layer after launch: wait for either screen.
            val deadline = System.currentTimeMillis() + CONTENT_TIMEOUT_MS
            while (System.currentTimeMillis() < deadline &&
                !device.hasObject(By.text(IDLE_TITLE)) && !device.hasObject(By.text(TRIP_STOP))
            ) {
                Thread.sleep(POLL_MS)
            }

            runCatching {
                val list = device.findObject(By.scrollable(true)) ?: return@runCatching
                list.fling(Direction.DOWN)
                device.waitForIdle()
                list.fling(Direction.UP)
                device.waitForIdle()
            }
        }
    }

    private companion object {
        /** How long the Data Layer gets to answer on a cold start. */
        const val CONTENT_TIMEOUT_MS = 15_000L
        const val POLL_MS = 250L

        /** The idle screen's title (idle_title). */
        const val IDLE_TITLE = "Belom OTW nih"

        /** The trip screen's last button (trip_action_stop). */
        const val TRIP_STOP = "Berhenti"
    }
}
