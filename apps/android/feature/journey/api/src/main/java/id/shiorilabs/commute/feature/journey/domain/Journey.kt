package id.shiorilabs.commute.feature.journey.domain

import java.time.Instant

/** A station as a trip answer names it. */
data class JourneyStop(
    /** `OPERATOR-CODE`. */
    val id: String,
    val name: String,
)

/** The answer for one station pair: every journey worth choosing between, best first. */
data class TripAnswer(
    val from: JourneyStop,
    val to: JourneyStop,
    val journeys: List<Journey>,
)

/**
 * One way of getting there, priced. `legs` is the trip as the rider makes it; `segments` is how the
 * fare is charged, which is not one to one with the legs.
 */
data class Journey(
    val legs: List<JourneyLeg>,
    val segments: List<FareSegment>,
    /** Rupiah; `null` when one of the fares is unknown. */
    val totalFare: Int?,
    val totalDistanceM: Int,
    /** Changes of vehicle, from the rider's side. */
    val transferCount: Int,
    val labels: List<JourneyLabel>,
    /** Times boarding; a same-platform change counts here but is not a transfer. */
    val boardings: Int,
    val walkDistanceM: Int,
    /** Only when every ride leg is timetabled, so never for a journey with TransJakarta in it. */
    val arrivalAt: Instant?,
)

sealed interface JourneyLeg {

    val from: JourneyStop
    val to: JourneyStop
    val distanceM: Int

    data class Ride(
        /** `OPERATOR:CODE`. */
        val line: String,
        val operator: String,
        override val from: JourneyStop,
        override val to: JourneyStop,
        /** Stations passed, both ends included. */
        val stationCount: Int,
        /** Every stop in order, boarding to alighting. */
        val stops: List<JourneyStop>,
        val headsign: String?,
        override val distanceM: Int,
        /**
         * The lines that run this stretch, primary first; any of them gets there. Just [line] with
         * its [headsign] when the track is not shared.
         */
        val serviceLines: List<ServiceLine>,
        val departureAt: Instant?,
        val arrivalAt: Instant?,
        /** The day's last service from [from] to [to]. */
        val lastService: Boolean,
        /** Field-verified boarding platform, stored bare (`3/4`). */
        val platformCode: String?,
    ) : JourneyLeg

    data class Transfer(
        override val from: JourneyStop,
        override val to: JourneyStop,
        override val distanceM: Int,
        /** Only on a paid corridor. */
        val fare: Int?,
        val corridorLabel: String?,
    ) : JourneyLeg
}

data class ServiceLine(
    /** `OPERATOR:CODE`. */
    val line: String,
    val headsign: String?,
)

data class FareSegment(
    val operator: String,
    val from: JourneyStop,
    val to: JourneyStop,
    val fare: Int?,
)

/**
 * Why a journey is offered. A label the app does not know yet is dropped on the way in rather than
 * shown raw.
 */
enum class JourneyLabel { CHEAPEST, FEWEST_CHANGES, LEAST_WALKING, SHORTEST_WAIT }
