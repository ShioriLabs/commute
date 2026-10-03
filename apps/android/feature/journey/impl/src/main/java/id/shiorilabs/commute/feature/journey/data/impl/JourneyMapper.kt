package id.shiorilabs.commute.feature.journey.data.impl

import id.shiorilabs.commute.core.model.models.FareJourney
import id.shiorilabs.commute.core.model.models.FareRideLeg
import id.shiorilabs.commute.core.model.models.FareTransferLeg
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.feature.journey.domain.FareSegment
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLabel
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.ServiceLine
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.roundToInt
import id.shiorilabs.commute.core.model.models.FareSegment as FareSegmentDto
import id.shiorilabs.commute.core.model.models.FareStation as FareStationDto

internal fun TripResult.toTripAnswer(): TripAnswer = TripAnswer(
    from = from.toStop(),
    to = to.toStop(),
    journeys = journeys.map { it.toJourney() },
)

private fun FareJourney.toJourney(): Journey = Journey(
    legs = legs.map { leg ->
        when (leg) {
            is FareRideLeg -> leg.toRide()
            is FareTransferLeg -> leg.toTransfer()
        }
    },
    segments = segments.map { it.toSegment() },
    totalFare = totalFare?.roundToInt(),
    totalDistanceM = totalDistanceM.roundToInt(),
    transferCount = transferCount.roundToInt(),
    // The API only ever adds labels; one this version does not know is dropped, not shown raw.
    labels = labels.mapNotNull { label -> JourneyLabel.entries.firstOrNull { it.name == label } },
    boardings = boardings.roundToInt(),
    walkDistanceM = walkDistanceM.roundToInt(),
    arrivalAt = arrivalAt?.toInstantOrNull(),
    resumesAt = resumesAt?.toInstantOrNull(),
)

private fun FareRideLeg.toRide(): JourneyLeg.Ride = JourneyLeg.Ride(
    line = line,
    operator = `operator`,
    from = from.toStop(),
    to = to.toStop(),
    stationCount = stationCount.roundToInt(),
    stops = stops.map { it.toStop() },
    headsign = headsign,
    distanceM = distanceM.roundToInt(),
    serviceLines = serviceLines?.map { ServiceLine(it.line, it.headsign) } ?: listOf(ServiceLine(line, headsign)),
    departureAt = departureAt?.toInstantOrNull(),
    arrivalAt = arrivalAt?.toInstantOrNull(),
    lastService = lastService == true,
    platformCode = platformCode,
)

private fun FareTransferLeg.toTransfer(): JourneyLeg.Transfer = JourneyLeg.Transfer(
    from = from.toStop(),
    to = to.toStop(),
    distanceM = distanceM.roundToInt(),
    fare = fare?.roundToInt(),
    corridorLabel = corridorLabel,
)

private fun FareSegmentDto.toSegment(): FareSegment = FareSegment(
    operator = `operator`,
    from = from.toStop(),
    to = to.toStop(),
    fare = fare?.roundToInt(),
)

private fun FareStationDto.toStop(): JourneyStop = JourneyStop(id = id, name = name)

/** The API stamps `+07:00`; a malformed time is dropped, as an untimed leg would be. */
private fun String.toInstantOrNull(): Instant? = runCatching { OffsetDateTime.parse(this).toInstant() }.getOrNull()
