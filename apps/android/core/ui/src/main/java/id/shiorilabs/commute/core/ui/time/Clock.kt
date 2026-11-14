package id.shiorilabs.commute.core.ui.time

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import id.shiorilabs.commute.core.time.JAKARTA
import kotlinx.coroutines.delay
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/** How often relative times ("5 mnt") are recomputed. */
private const val TICK_MILLIS = 10_000L

/**
 * The seconds of each minute a timetable board can read differently at: the minute turning, a
 * train gone a minute dropping off the board (`nextDepartures`), and "N mnt" rounding to the next
 * N (`departureLabel`). Departures are whole minutes, so nothing on it changes in between.
 */
private val TIMETABLE_SECONDS = listOf(0L, 1L, 31L)

/** Past the tick, so the clock read on waking is never a hair short of it. */
private const val TICK_SLACK_MILLIS = 5L

/**
 * Jakarta wall-clock time, refreshed every 10 s while the screen is resumed: the clock departure
 * times are read against.
 *
 * Paused in the background, and refreshed the moment the screen comes back, so a "5 mnt" left
 * standing while the app was away corrects itself before anyone reads it. One per screen: call it
 * once and hand the value to every card, as the web shares one clock across its feed.
 */
@Composable
fun rememberJakartaNow(clock: Clock = remember { Clock.system(JAKARTA) }): LocalDateTime =
    rememberTickingNow(clock) { TICK_MILLIS }

/**
 * [rememberJakartaNow] for a board of timetabled departures, whole minutes all: refreshed only at
 * the seconds it can change at ([nextTimetableTick]), so it's on time to the second and recomposes
 * half as often.
 */
@Composable
fun rememberTimetableNow(clock: Clock = remember { Clock.system(JAKARTA) }): LocalDateTime =
    rememberTickingNow(clock) { now -> Duration.between(now, nextTimetableTick(now)).toMillis() + TICK_SLACK_MILLIS }

/** The first second after [now] a timetable board can change at. */
fun nextTimetableTick(now: LocalDateTime): LocalDateTime {
    val minute = now.truncatedTo(ChronoUnit.MINUTES)
    return TIMETABLE_SECONDS.map(minute::plusSeconds).firstOrNull { it.isAfter(now) } ?: minute.plusMinutes(1)
}

/**
 * The moment it is, refreshed every [periodMillis] while the screen is resumed: what a countdown
 * of minutes ("3 mnt lagi") is read against. Paused and caught up as [rememberJakartaNow] is.
 */
@Composable
fun rememberNow(periodMillis: Long): Instant = rememberTicking(Unit, Instant::now) { periodMillis }

@Composable
private fun rememberTickingNow(clock: Clock, wait: (LocalDateTime) -> Long): LocalDateTime =
    rememberTicking(clock, { LocalDateTime.now(clock) }, wait)

/** [read] again after each [wait], while resumed, and the moment the screen comes back. */
@Composable
private fun <T> rememberTicking(key: Any, read: () -> T, wait: (T) -> Long): T {
    var now by remember(key) { mutableStateOf(read()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentWait by rememberUpdatedState(wait)

    LaunchedEffect(lifecycleOwner, key) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                val value = read()
                now = value
                delay(currentWait(value))
            }
        }
    }

    return now
}
