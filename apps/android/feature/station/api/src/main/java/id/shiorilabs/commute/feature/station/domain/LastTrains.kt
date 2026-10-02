package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.time.lastDepartures
import id.shiorilabs.commute.core.time.serviceStartMinute

/** How many of the last departures each destination shows, the web's default. */
private const val LAST_TRAIN_COUNT = 3

/** One terminus's last departures, earliest first: the last of them is the last train. */
data class LastTrainDestination(
    /** Stable across fetches: the direction group, terminus and route together. */
    val key: String,
    val boundFor: String,
    val via: String?,
    /** Minutes since midnight, in service-day order. */
    val minutes: List<Int>,
)

/** A line's last departures, one row per terminus. */
data class LastTrainLine(
    /** `OPERATOR:CODE`. */
    val lineKey: String,
    val destinations: List<LastTrainDestination>,
)

/**
 * The last few departures to each destination, in service-day order: the web's `LastDepartures`.
 *
 * It answers the late-night question the upcoming board can't: at 23.40, "next in 6 mnt" doesn't
 * say whether that's the train home or the one after it. Per destination rather than per direction,
 * so a short-turn gets its own row: the last train towards Bogor can stop at Depok, and a rider
 * needs to see that before boarding it.
 *
 * A line that never stops (no overnight gap) has no last train and is left out, rather than showing
 * whichever departures sort last by the clock. Its service start is taken over the whole line, as
 * [serviceStartMinute] asks.
 */
fun lastTrains(timetable: List<LineTimetable>): List<LastTrainLine> = timetable.mapNotNull { line ->
    val start = serviceStartMinute(
        line.groups.flatMap { group -> group.destinations.flatMap { destination -> destination.departures.map { it.minute } } },
    ) ?: return@mapNotNull null
    val destinations = line.groups.flatMap { group ->
        group.destinations.map { destination ->
            LastTrainDestination(
                key = "${group.key}:${destination.boundFor}:${destination.via.orEmpty()}",
                boundFor = destination.boundFor,
                via = destination.via,
                minutes = lastDepartures(destination.departures, start, LAST_TRAIN_COUNT) { it.minute }.map { it.minute },
            )
        }
    }.filter { it.minutes.isNotEmpty() }
    destinations.takeIf { it.isNotEmpty() }?.let { LastTrainLine(line.lineKey, it) }
}
