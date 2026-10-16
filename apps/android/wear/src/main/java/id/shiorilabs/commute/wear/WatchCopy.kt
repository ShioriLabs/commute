package id.shiorilabs.commute.wear

import android.content.res.Resources
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.laterThan
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.tripcopy.TripWording
import id.shiorilabs.commute.core.wearable.WearLine
import java.time.Instant

/**
 * The trip in words on the watch: the phone's Live Update wording, shortened for a round screen,
 * with times as minutes from now where they're near. [lines] names the rides; a line it lacks shows
 * its bare code.
 */
class WatchCopy(private val resources: Resources, private val lines: Map<String, WearLine>) {

    private val wording = TripWording(resources) { lines[it]?.name }

    fun rideName(ride: TripLeg.Ride): String = wording.rideName(ride)

    fun direction(ride: TripLeg.Ride): String? = wording.direction(ride)

    fun title(headline: Headline): String = wording.title(headline)

    /** The small line over [place]: what to do there. */
    fun lead(headline: Headline): String = resources.getString(
        when (headline) {
            is Headline.Board -> R.string.trip_lead_board
            is Headline.Change -> R.string.trip_lead_change
            is Headline.RideTo, is Headline.AlightNow -> R.string.trip_lead_alight
            is Headline.Arrived -> R.string.trip_lead_arrived
        },
    )

    /** What the screen leads with, big: the ride to take, or the stop to get off at. */
    fun place(headline: Headline): String = when (headline) {
        is Headline.Board -> rideName(headline.ride)
        is Headline.Change -> rideName(headline.ride)
        is Headline.RideTo -> headline.ride.stops.last().name
        is Headline.AlightNow -> headline.ride.stops.last().name
        is Headline.Arrived -> headline.destination
    }

    /** [countdownMinutes], in words: "4 mnt". */
    fun minutes(state: TripState, headline: Headline, now: Instant): String? =
        countdownMinutes(headline, state.source, now)?.let { resources.getString(R.string.trip_minutes, it) }

    /** The [hero]'s figure, big: "12", "3", "18.50". `null` for [Hero.Place], which [place] says. */
    fun heroFigure(hero: Hero): String? = when (hero) {
        is Hero.Minutes -> hero.minutes.toString()
        is Hero.StopsLeft -> hero.stops.toString()
        is Hero.Clock -> formatClock(hero.at)
        Hero.Place -> null
    }

    /** What the [hero]'s figure counts, under it; a clock needs nothing. */
    fun heroUnit(hero: Hero): String? = when (hero) {
        is Hero.Minutes -> resources.getString(R.string.trip_hero_minutes)
        is Hero.StopsLeft -> resources.getString(if (hero.bus) R.string.trip_hero_haltes else R.string.trip_hero_stations)
        is Hero.Clock, Hero.Place -> null
    }

    /** What else there is to know, after [minutes]. */
    fun detail(state: TripState, headline: Headline, now: Instant): String =
        details(headline, showsDeparture = minutes(state, headline, now) != null, showsStops = false).joinToString(SEPARATOR)

    /**
     * What else there is to know under the [hero], which already says its own part: led, while a
     * ride is still to be caught, by where it heads, which nothing else on the screen says.
     */
    fun heroDetail(headline: Headline, hero: Hero): String {
        val heads = when (headline) {
            is Headline.Board -> direction(headline.ride)
            is Headline.Change -> direction(headline.ride)
            else -> null
        }
        val rest = details(headline, showsDeparture = hero is Hero.Minutes || hero is Hero.Clock, showsStops = hero is Hero.StopsLeft)
        return listOfNotNull(heads).plus(rest).joinToString(SEPARATOR)
    }

    private fun details(headline: Headline, showsDeparture: Boolean, showsStops: Boolean): List<String> = when (headline) {
        is Headline.Board -> listOfNotNull(
            platform(headline.ride),
            headline.departsAt?.takeUnless { showsDeparture }
                ?.let { resources.getString(CopyR.string.trip_departs_at, formatClock(it)) },
        )
        is Headline.Change -> listOfNotNull(
            headline.walk?.let { walk ->
                platform(headline.ride)
                    ?.let { resources.getString(CopyR.string.trip_walk_to_platform, walk.to.name, it) }
                    ?: resources.getString(CopyR.string.trip_walk_to, walk.to.name)
            },
            platform(headline.ride).takeIf { headline.walk == null },
            headline.departsAt?.takeUnless { showsDeparture }
                ?.let { resources.getString(CopyR.string.trip_departs_at, formatClock(it)) },
        )
        is Headline.RideTo -> listOfNotNull(
            resources.getString(
                if (headline.ride.isBus) CopyR.string.trip_haltes_left else CopyR.string.trip_stations_left,
                headline.stopsLeft,
            ).takeUnless { showsStops },
        )
        is Headline.AlightNow -> listOf(
            headline.then?.let { resources.getString(CopyR.string.trip_then_change, rideName(it)) }
                ?: resources.getString(CopyR.string.trip_then_done),
        )
        is Headline.Arrived -> emptyList()
    }

    /** [minutes] and [detail] on one line, for the notification. */
    fun summary(state: TripState, headline: Headline, now: Instant): String =
        listOfNotNull(minutes(state, headline, now), detail(state, headline, now).ifEmpty { null })
            .joinToString(SEPARATOR)

    /** How the position is known, when it isn't from GPS; `null` once arrived. */
    fun source(state: TripState): String? = when {
        state.phase == TripPhase.ARRIVED -> null
        state.source == PositionSource.ESTIMATED -> resources.getString(CopyR.string.trip_source_estimated)
        state.source == PositionSource.UNKNOWN -> resources.getString(CopyR.string.trip_source_unknown)
        else -> null
    }

    /** The small line under a [Moment]'s place: the walk to a ride, its platform, and the trains after it. */
    fun momentNote(moment: Moment, now: Instant? = null): String = listOfNotNull(
        moment.walkM?.let { resources.getString(R.string.trip_moment_walk, it) },
        moment.platform?.let(::platform),
        later(moment, now),
    ).joinToString(SEPARATOR)

    /** "berikutnya 08.22, 08.33": what would be boarded if this were missed, once a clock says which are left. */
    private fun later(moment: Moment, now: Instant?): String? {
        now ?: return null
        val times = moment.later.laterThan(moment.at, now).take(NEXT_SHOWN)
        return times.takeIf { it.isNotEmpty() }
            ?.let { resources.getString(CopyR.string.trip_next_departures, it.joinToString(", ") { time -> formatClock(time) }) }
    }

    private fun platform(ride: TripLeg.Ride): String? = ride.platformCode?.let(::platform)

    private fun platform(code: String): String = resources.getString(CopyR.string.trip_platform, code.replace(PLATFORM_SLASH, "·"))

    companion object {

        const val SEPARATOR = " · "

        /** Later trains a screen names after the one waited for; the notification and complication have no room for more. */
        private const val NEXT_SHOWN = 2
        private val PLATFORM_SLASH = Regex("\\s*/\\s*")
    }
}
