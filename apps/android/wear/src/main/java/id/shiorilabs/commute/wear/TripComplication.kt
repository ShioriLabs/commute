package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.headline
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.core.wearable.WearTrip
import java.time.Instant

/**
 * The running trip as the "OTW" complication shows it, before it is put into a watch face's terms:
 * the trip screen's big figure, how far along the trip is, and getting on or off.
 */
data class TripComplication(
    val headline: Headline,
    val hero: Hero,
    /** When [hero] is minutes, the moment they count to, so the watch face counts them down itself. */
    val countdownTo: Instant?,
    /** How much of the trip is ridden, 0 to 1. */
    val progress: Float,
    /** Each ride's line colour, in order, as ARGB. */
    val colors: List<Int>,
    /** Waiting to get on, rather than riding to get off. */
    val boarding: Boolean,
)

/** [trip] as the complication shows it; `null` with no trip running. */
fun tripComplication(trip: WearTrip?, now: Instant): TripComplication? {
    if (trip == null || trip.finished != null) return null
    val headline = trip.state.headline(trip.plan)
    return TripComplication(
        headline = headline,
        hero = tripHero(headline, trip.state.source, now),
        countdownTo = countdownTo(headline, trip.state.source, now),
        progress = trip.state.progress(trip.plan).fraction.toFloat(),
        colors = trip.plan.rideIndices.map { trip.lines[trip.plan.ride(it).line]?.color ?: ACCENT },
        boarding = headline is Headline.Board || headline is Headline.Change,
    )
}

/** The brand pink, `CommuteWatchTheme`'s primary: a line the trip doesn't name. */
private val ACCENT = 0xFFF55875.toInt()
