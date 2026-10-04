package id.shiorilabs.commute.feature.trip.presentation

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")
private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH.mm").withZone(JAKARTA)

/** `08.11`, the way the rest of the app writes a time, in WIB wherever the phone is. */
internal fun formatClock(at: Instant): String = CLOCK.format(at)
