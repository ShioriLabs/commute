package id.shiorilabs.commute.feature.journey.domain

import java.time.Instant

/** Small hand-built journeys for the pure-logic tests. */
internal fun stop(id: String, name: String = id) = JourneyStop(id, name)

internal fun ride(
    line: String,
    from: String,
    to: String,
    distanceM: Int = 1000,
    operator: String = line.substringBefore(':'),
    departureAt: Instant? = null,
    arrivalAt: Instant? = null,
    lastService: Boolean = false,
) = JourneyLeg.Ride(
    line = line,
    operator = operator,
    from = stop(from),
    to = stop(to),
    stationCount = 2,
    stops = listOf(stop(from), stop(to)),
    headsign = null,
    distanceM = distanceM,
    serviceLines = listOf(ServiceLine(line, null)),
    departureAt = departureAt,
    arrivalAt = arrivalAt,
    lastService = lastService,
    platformCode = null,
)

internal fun walk(from: String, to: String, distanceM: Int = 100, fare: Int? = null, corridorLabel: String? = null) =
    JourneyLeg.Transfer(stop(from), stop(to), distanceM, fare, corridorLabel)

internal fun journey(vararg legs: JourneyLeg, labels: List<JourneyLabel> = emptyList()) = Journey(
    legs = legs.toList(),
    segments = emptyList(),
    totalFare = 3500,
    totalDistanceM = legs.sumOf { it.distanceM },
    transferCount = legs.count { it is JourneyLeg.Transfer },
    labels = labels,
    boardings = legs.count { it is JourneyLeg.Ride },
    walkDistanceM = legs.filterIsInstance<JourneyLeg.Transfer>().sumOf { it.distanceM },
    arrivalAt = null,
)
