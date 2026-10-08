package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.feature.trip.ActiveTrip
import java.time.Instant

/** One stop on [PidsStyle.Yishun]'s strip. */
data class YishunStop(
    /** Its index along the ride. */
    val index: Int,
    val id: String,
    val name: String,
    /** Whole minutes away, for a stop still ahead when the timetable or a fix can say. */
    val minutes: Int?,
    /** Behind the rider: drawn grey. */
    val passed: Boolean,
    /** The stop the big name is about. */
    val focus: Boolean,
    /** The stop to get off at: always drawn, tagged "Turun". */
    val last: Boolean,
)

/**
 * The stops [PidsStyle.Yishun] draws along its line: a window around where the rider is, and the
 * stop to get off at. A long ride's middle isn't drawn: a rider boarding at Bogor sees neither Juanda
 * nor Jakarta Kota's neighbours, only how many stops lie between ([skipped]) and the last one.
 */
data class YishunStrip(
    val stops: List<YishunStop>,
    /** Stops between the window and the last stop, not drawn; `0` when the strip runs on to it. */
    val skipped: Int,
)

/** Passed stops kept on the strip, behind the one the big name is about. */
internal const val YISHUN_BEHIND = 2

/** Stops kept after it, before the strip breaks off toward the last one. */
internal const val YISHUN_AHEAD = 3

/** The strip for [pids] (this trip's board at [now]); `null` once arrived, when there's nothing left to ride. */
internal fun ActiveTrip.yishunStrip(pids: Pids, now: Instant): YishunStrip? {
    if (pids.label == PidsLabel.ARRIVED) return null
    val ride = pids.ride
    val last = ride.lastIndex
    val focus = pids.focus.coerceIn(0, last)
    val first = (focus - YISHUN_BEHIND).coerceAtLeast(0)
    // A gap of one stop takes the room of the stop itself: run on to the last one rather than skip it.
    val windowEnd = if (last <= focus + YISHUN_AHEAD + 2) last else focus + YISHUN_AHEAD
    val indices = (first..windowEnd).toList() + listOfNotNull(last.takeIf { it > windowEnd })
    val stops = indices.map { index ->
        val stop = ride.stops[index]
        YishunStop(
            index = index,
            id = stop.id,
            name = stop.name,
            minutes = if (index > focus || (index == focus && pids.label != PidsLabel.AT)) minutesToStop(index, now) else null,
            passed = index < focus,
            focus = index == focus,
            last = index == last,
        )
    }
    return YishunStrip(stops, skipped = (last - windowEnd - 1).coerceAtLeast(0))
}
