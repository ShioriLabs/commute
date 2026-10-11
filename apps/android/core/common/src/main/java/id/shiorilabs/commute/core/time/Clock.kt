package id.shiorilabs.commute.core.time

import java.time.Instant
import java.time.format.DateTimeFormatter

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH.mm").withZone(JAKARTA)
private val CLOCK_SECONDS: DateTimeFormatter = DateTimeFormatter.ofPattern("HH.mm.ss").withZone(JAKARTA)

/** `08.11`, the way the rest of the app writes a time, in WIB wherever the phone or watch is. */
fun formatClock(at: Instant): String = CLOCK.format(at)

/** `08.11.42`: [formatClock] to the second, for a mark a field test lines up with the log. */
fun formatClockSeconds(at: Instant): String = CLOCK_SECONDS.format(at)
