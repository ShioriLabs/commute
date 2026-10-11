package id.shiorilabs.commute.core.tripcopy

import android.content.res.Resources
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.TripLeg

/**
 * The words the phone and the watch say a trip's rides in, so a Live Update and a watch face name
 * the same line the same way. [lineName] resolves a line key to its name; a line it lacks shows
 * its bare code.
 */
class TripWording(private val resources: Resources, private val lineName: (String) -> String?) {

    /**
     * The ride's line, and how many others will do: "4D +4 lainnya" for haltes five routes serve. A
     * bus route goes by its code, "Koridor L13E", its name ("Puri Beta – Flyover Kuningan") being far
     * too long.
     */
    fun rideName(ride: TripLeg.Ride): String {
        val code = ride.line.substringAfter(':')
        val name = lineName(ride.line) ?: code
        if (ride.otherLines == 0) return if (ride.isBus) resources.getString(R.string.trip_corridor, code) else name
        return resources.getString(R.string.trip_ride_more, if (ride.isBus) code else name, ride.otherLines)
    }

    /** [tripDirection] for this wording's resources. */
    fun direction(ride: TripLeg.Ride): String? = tripDirection(resources, ride)

    fun title(headline: Headline): String = when (headline) {
        is Headline.Board -> resources.getString(R.string.trip_board, rideName(headline.ride))
        is Headline.Change -> resources.getString(R.string.trip_change, rideName(headline.ride))
        is Headline.RideTo -> resources.getString(R.string.trip_ride_to, headline.ride.stops.last().name)
        is Headline.AlightNow -> resources.getString(R.string.trip_alight_now, headline.ride.stops.last().name)
        is Headline.Arrived -> resources.getString(R.string.trip_arrived, headline.destination)
    }
}

/**
 * Which way the ride goes: "arah" its terminus when every line that will do heads there; with
 * lines that part ways (an L13E for a 4D), "via" the stop to get off at, which all of them reach.
 */
fun tripDirection(resources: Resources, ride: TripLeg.Ride): String? =
    ride.sharedHeadsign?.let { resources.getString(R.string.trip_headsign, it) }
        ?: ride.takeIf { it.otherLines > 0 }?.let { resources.getString(R.string.trip_via, it.stops.last().name) }
