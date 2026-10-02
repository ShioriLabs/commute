package id.shiorilabs.commute

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.navigation.routeForLink
import kotlinx.coroutines.flow.MutableStateFlow

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

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

        setContent {
            CommuteApp(pendingLink = pendingLink)
        }
    }

    /** A link opened while the app is already up (it is singleTop) lands on top of where the rider is. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.linkRoute()?.let { pendingLink.value = it }
    }

    private fun Intent.linkRoute(): Route? =
        dataString?.takeIf { action == Intent.ACTION_VIEW }?.let(::routeForLink)
}
