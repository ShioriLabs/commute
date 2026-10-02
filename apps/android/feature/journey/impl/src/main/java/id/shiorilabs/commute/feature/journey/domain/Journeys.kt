package id.shiorilabs.commute.feature.journey.domain

import java.time.Instant

/*
 * Reading a journey for display: the web's `fare-sheet/journeys.ts`.
 */

/**
 * Badge order. The engine assigns labels in its own order, which puts price last, and price is
 * what riders scan for first. A fixed order also means two cards never disagree about which shared
 * label leads.
 */
private val LABEL_ORDER = listOf(
    JourneyLabel.CHEAPEST,
    JourneyLabel.FEWEST_CHANGES,
    JourneyLabel.LEAST_WALKING,
    JourneyLabel.SHORTEST_WAIT,
)

fun sortJourneyLabels(labels: Collection<JourneyLabel>): List<JourneyLabel> = LABEL_ORDER.filter { it in labels }

/** How many labels a card wears: a row with four reasons is making none of them. */
const val JOURNEY_LABELS_SHOWN = 2

val Journey.rides: List<JourneyLeg.Ride> get() = legs.filterIsInstance<JourneyLeg.Ride>()

/** The first timed ride's departure: when the rider actually boards. */
val Journey.boardsAt: Instant? get() = rides.firstNotNullOfOrNull { it.departureAt }

/** Whether any ride is the day's last service. */
val Journey.isLastTrain: Boolean get() = rides.any { it.lastService }

/** Paid corridor transfers, which the fare breakdown lists beside the operators' segments. */
val Journey.surchargedTransfers: List<JourneyLeg.Transfer>
    get() = legs.filterIsInstance<JourneyLeg.Transfer>().filter { it.fare != null && it.corridorLabel != null }

/**
 * The line a journey is boarded on and the one it is left from. A stop's own line list cannot say:
 * Manggarai serves three lines and leads with the airport's.
 */
data class BoardingLines(val from: String?, val to: String?)

fun boardingLineKeys(journey: Journey?): BoardingLines {
    val rides = journey?.rides.orEmpty()
    return BoardingLines(from = rides.firstOrNull()?.line, to = rides.lastOrNull()?.line)
}
