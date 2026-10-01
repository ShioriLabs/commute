package id.shiorilabs.commute.core.ui.time

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import id.shiorilabs.commute.core.time.JAKARTA
import kotlinx.coroutines.delay
import java.time.Clock
import java.time.LocalDateTime

/** How often relative times ("5 mnt") are recomputed. */
private const val TICK_MILLIS = 10_000L

/**
 * Jakarta wall-clock time, refreshed every 10 s while the screen is resumed: the clock departure
 * times are read against.
 *
 * Paused in the background, and refreshed the moment the screen comes back, so a "5 mnt" left
 * standing while the app was away corrects itself before anyone reads it. One per screen: call it
 * once and hand the value to every card, as the web shares one clock across its feed.
 */
@Composable
fun rememberJakartaNow(clock: Clock = remember { Clock.system(JAKARTA) }): LocalDateTime {
    var now by remember { mutableStateOf(LocalDateTime.now(clock)) }
    val lifecycleOwner = LocalLifecycleOwner.current

    LaunchedEffect(lifecycleOwner, clock) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                now = LocalDateTime.now(clock)
                delay(TICK_MILLIS)
            }
        }
    }

    return now
}
