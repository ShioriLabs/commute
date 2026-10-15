package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.minutesUntil
import java.time.Instant

/** The one big figure the trip screen leads with, as Health leads with the heart rate. */
sealed interface Hero {

    /** Minutes to the moment that matters: the train leaving, or getting off. */
    data class Minutes(val minutes: Int) : Hero

    /** Stops to getting off, when there's no near time to count to. */
    data class StopsLeft(val stops: Int, val bus: Boolean) : Hero

    /** When the train is timetabled to leave, an hour or more off or already due. */
    data class Clock(val at: Instant) : Hero

    /** No figure to give: the place itself is said big. */
    data object Place : Hero
}

fun tripHero(headline: Headline, source: PositionSource, now: Instant): Hero {
    countdownMinutes(headline, source, now)?.let { return Hero.Minutes(it) }
    return when (headline) {
        is Headline.RideTo -> Hero.StopsLeft(headline.stopsLeft, headline.ride.isBus)
        is Headline.Board -> headline.departsAt?.let(Hero::Clock) ?: Hero.Place
        is Headline.Change -> headline.departsAt?.let(Hero::Clock) ?: Hero.Place
        is Headline.AlightNow, is Headline.Arrived -> Hero.Place
    }
}

/**
 * Minutes to the moment that matters, when it's within the hour: the train leaving while it's
 * waited for, getting off once aboard, so long as somewhere on the route is known. `null` when
 * there is no time to count to.
 */
fun countdownMinutes(headline: Headline, source: PositionSource, now: Instant): Int? =
    countdownTo(headline, source, now)?.let { minutesUntil(now, it) }

/** The moment [countdownMinutes] counts to, for a clock that counts down on its own. */
fun countdownTo(headline: Headline, source: PositionSource, now: Instant): Instant? {
    val at = when (headline) {
        is Headline.Board -> headline.departsAt
        is Headline.Change -> headline.departsAt
        is Headline.RideTo -> headline.alightsAt?.takeIf { source != PositionSource.UNKNOWN }
        else -> null
    } ?: return null
    if (!at.isAfter(now) || minutesUntil(now, at) >= NEAR_MINUTES) return null
    return at
}

private const val NEAR_MINUTES = 60
