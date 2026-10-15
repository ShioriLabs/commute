package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.wearable.WearDirection
import id.shiorilabs.commute.core.wearable.WearStation
import id.shiorilabs.commute.core.wearable.nextDepartures
import java.time.Duration
import java.time.Instant

/**
 * What a departures slot shows [from] one moment [until] the next, laid out ahead so the watch face
 * moves on to the next train by itself as each one leaves.
 */
data class DepartureFrame(
    val from: Instant,
    val until: Instant,
    /** The next trains from [from] on, soonest first; the first leaves at [until]. */
    val next: List<Instant>,
    /** The first counts down; an hour or more off, it shows as a clock instead. */
    val countdown: Boolean,
)

/**
 * The frames from [now] over the next [horizon]: one per train, each showing the [shown] trains
 * still to come, split an hour before a far one so it counts down only once near.
 */
fun WearDirection.departureFrames(
    now: Instant,
    shown: Int = SHOWN,
    horizon: Duration = HORIZON,
    max: Int = MAX_FRAMES,
): List<DepartureFrame> {
    val departures = nextDepartures(now, max + shown)
    val end = now.plus(horizon)
    val frames = mutableListOf<DepartureFrame>()
    var from = now
    for (i in departures.indices) {
        if (from.isAfter(end) || frames.size >= max) break
        val until = departures[i]
        val next = departures.subList(i, minOf(i + shown, departures.size))
        val near = until.minus(COUNTDOWN_WITHIN)
        if (near.isAfter(from)) {
            frames += DepartureFrame(from, near, next, countdown = false)
            frames += DepartureFrame(near, until, next, countdown = true)
        } else {
            frames += DepartureFrame(from, until, next, countdown = true)
        }
        from = until
    }
    return frames
}

/** A copy the phone hasn't refreshed in two weeks, though it resends weekly: worth asking for again. */
fun WearStation.isStale(now: Instant): Boolean = Duration.between(Instant.ofEpochMilli(builtAt), now) > STALE_AFTER

/** A direction's last station, all a small slot has room for: "Depok · Bogor" is "Bogor". */
fun shortLabel(label: String): String = label.substringAfterLast(" · ")

private const val SHOWN = 3
private const val MAX_FRAMES = 30
private val HORIZON: Duration = Duration.ofHours(3)
private val COUNTDOWN_WITHIN: Duration = Duration.ofHours(1)
private val STALE_AFTER: Duration = Duration.ofDays(14)
