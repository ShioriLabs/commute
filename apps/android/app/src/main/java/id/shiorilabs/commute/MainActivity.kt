package id.shiorilabs.commute

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.navigation.routeForLink
import id.shiorilabs.commute.core.ui.startup.LocalStartupGate
import id.shiorilabs.commute.core.ui.startup.StartupGate
import id.shiorilabs.commute.feature.trip.ActiveTripBar
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var developerPreferences: DeveloperPreferencesRepository

    @Inject
    lateinit var tripBar: ActiveTripBar

    /** A web link the app was opened with, waiting for the navigator to open it. */
    private val pendingLink = MutableStateFlow<Route?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Both bars are fully transparent and the theme is light only, so the bars always take dark
        // icons. Insets themselves are handled in Compose: `CommuteApp` hands each screen the
        // system-bar padding.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )

        // Only on a fresh start: a recreated activity's back stack already holds the link's screen.
        if (savedInstanceState == null) {
            pendingLink.value = intent.linkRoute()
        }

        val startupGate = StartupGate()
        holdSplashUntil(startupGate)

        setContent {
            CompositionLocalProvider(LocalStartupGate provides startupGate) {
                CommuteApp(pendingLink = pendingLink, frostTuner = developerPreferences.frostTuner, tripBar = tripBar)
            }
        }
    }

    /**
     * Keeps the splash up, by holding back the first draw, while a screen's first content is still
     * loading off disk ([gate]), for at most [MAX_SPLASH_HOLD_MILLIS]: the reveal already plays that
     * long, so the wait costs nothing a rider can see, and the screen opens on its content instead
     * of its skeleton. Composition and layout carry on underneath, so the loads it waits on run.
     */
    private fun holdSplashUntil(gate: StartupGate) {
        val content = findViewById<View>(android.R.id.content)
        val heldSince = SystemClock.uptimeMillis()
        content.viewTreeObserver.addOnPreDrawListener(
            object : ViewTreeObserver.OnPreDrawListener {
                override fun onPreDraw(): Boolean {
                    val ready = gate.isOpen || SystemClock.uptimeMillis() - heldSince >= MAX_SPLASH_HOLD_MILLIS
                    if (ready) {
                        gate.open()
                        content.viewTreeObserver.removeOnPreDrawListener(this)
                    }
                    return ready
                }
            },
        )
    }

    /** A link opened while the app is already up (it is singleTop) lands on top of where the rider is. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.linkRoute()?.let { pendingLink.value = it }
    }

    private fun Intent.linkRoute(): Route? =
        dataString?.takeIf { action == Intent.ACTION_VIEW }?.let(::routeForLink)
}

/**
 * The longest the splash is held for a screen's first content: the length of its reveal
 * (`windowSplashScreenAnimationDuration`), so the hold never outlasts what plays anyway.
 */
private const val MAX_SPLASH_HOLD_MILLIS = 760L
