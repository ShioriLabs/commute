package id.shiorilabs.commute

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBars
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.navigation.rememberCommuteNavigator
import id.shiorilabs.commute.core.ui.debug.FrostTunerOverlay
import id.shiorilabs.commute.core.ui.frost.FrostTuning
import id.shiorilabs.commute.core.ui.frost.LocalFrostTuning
import id.shiorilabs.commute.core.ui.theme.CommuteTheme
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.filterNotNull

/**
 * The app. [pendingLink] carries a web link's screen (a shared OTW link) from the activity; it is
 * opened over home, so back from it lands somewhere, and then cleared.
 */
@Composable
fun CommuteApp(
    pendingLink: MutableStateFlow<Route?> = MutableStateFlow(null),
    frostTuner: Flow<Boolean> = flowOf(false),
) {
    CommuteTheme {
        val navigator = rememberCommuteNavigator()
        val screenPadding = WindowInsets.systemBars.asPaddingValues()
        // The pinned headers' frost, tuned live from the frost tuner below while it's switched on
        // (Pengaturan → Experimental); otherwise never changed.
        val frostTuning = remember { FrostTuning() }
        val showFrostTuner by frostTuner.collectAsState(initial = false)

        LaunchedEffect(navigator, pendingLink) {
            pendingLink.filterNotNull().collect { route ->
                navigator.goTo(route)
                pendingLink.value = null
            }
        }

        CompositionLocalProvider(
            LocalNavigator provides navigator,
            LocalFrostTuning provides frostTuning,
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                CommuteNavDisplay(
                    navigator = navigator,
                    screenPadding = { screenPadding },
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.background),
                )
                if (showFrostTuner) {
                    FrostTunerOverlay(tuning = frostTuning)
                }
            }
        }
    }
}
