package id.shiorilabs.commute.feature.journey.presentation

import id.shiorilabs.commute.feature.journey.domain.FareSegment
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLabel
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.LegDeparture
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.domain.RouteBarSegment
import id.shiorilabs.commute.feature.journey.domain.ServiceLine
import id.shiorilabs.commute.feature.search.domain.SearchLine
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/** Sample data for the journey `@Preview`s: Bogor to Sudirman with one change at Manggarai. */
internal object JourneyPreviewData {

    private val bogor = JourneyStop("KCI-BOO", "Bogor")
    private val manggarai = JourneyStop("KCI-MRI", "Manggarai")
    private val sudirman = JourneyStop("KCI-SUD", "Sudirman")

    private val base = Instant.parse("2026-10-05T01:00:00Z")

    val now: Instant = base.minusSeconds(5 * 60)

    val lines = mapOf(
        "KCI:BOO" to LineInfo("Commuter Line Bogor", "B", "#E4002B", "KCI"),
        "KCI:CKR" to LineInfo("Commuter Line Cikarang", "C", "#00A9E0", "KCI"),
    )

    val bogorLine = SearchLine("Commuter Line Bogor", "B", "#E4002B", "KCI")
    val cikarangLine = SearchLine("Commuter Line Cikarang", "C", "#00A9E0", "KCI")

    val stations = listOf(
        PickableStation("KCI-BOO", "Bogor", "KCI", listOf(bogorLine), score = null, siblingIds = emptyList(), keywords = emptyList()),
        PickableStation("KCI-MRI", "Manggarai", "KCI", listOf(bogorLine, cikarangLine), score = null, siblingIds = emptyList(), keywords = emptyList()),
        PickableStation("KCI-SUD", "Sudirman", "KCI", listOf(cikarangLine), score = null, siblingIds = emptyList(), keywords = emptyList()),
    )

    /** Four minutes apart in the far end of the hour, so the second ride has trains to connect to. */
    private fun departures(line: String, firstMinute: Long, count: Int, rideMinutes: Long, headsign: String) =
        (0 until count).map { i ->
            val leaves = base.plusSeconds((firstMinute + i * 12) * 60)
            LegDeparture(leaves, leaves.plusSeconds(rideMinutes * 60), "$line-$i", line, headsign)
        }

    private val firstRide = departures("KCI:BOO", firstMinute = 8, count = 3, rideMinutes = 52, headsign = "Jakarta Kota")
    private val secondRide = departures("KCI:CKR", firstMinute = 66, count = 3, rideMinutes = 9, headsign = "Cikarang")

    val journey = Journey(
        legs = listOf(
            JourneyLeg.Ride(
                line = "KCI:BOO",
                operator = "KCI",
                from = bogor,
                to = manggarai,
                stationCount = 14,
                stops = listOf(bogor, manggarai),
                headsign = "Jakarta Kota",
                distanceM = 50_000,
                serviceLines = listOf(ServiceLine("KCI:BOO", "Jakarta Kota")),
                departureAt = firstRide[0].departureAt,
                arrivalAt = firstRide[0].arrivalAt,
                lastService = false,
                platformCode = "3",
                tripId = firstRide[0].tripId,
                upcomingDepartures = firstRide,
            ),
            JourneyLeg.Transfer(manggarai, manggarai, distanceM = 80, fare = null, corridorLabel = null),
            JourneyLeg.Ride(
                line = "KCI:CKR",
                operator = "KCI",
                from = manggarai,
                to = sudirman,
                stationCount = 3,
                stops = listOf(manggarai, sudirman),
                headsign = "Cikarang",
                distanceM = 4_000,
                serviceLines = listOf(ServiceLine("KCI:CKR", "Cikarang")),
                departureAt = secondRide[0].departureAt,
                arrivalAt = secondRide[0].arrivalAt,
                lastService = false,
                platformCode = null,
                tripId = secondRide[0].tripId,
                upcomingDepartures = secondRide,
                minChangeS = 180,
            ),
        ),
        segments = listOf(FareSegment("KCI", bogor, sudirman, 6_000)),
        totalFare = 6_000,
        totalDistanceM = 54_080,
        transferCount = 1,
        labels = listOf(JourneyLabel.CHEAPEST, JourneyLabel.FEWEST_CHANGES),
        boardings = 2,
        walkDistanceM = 80,
        arrivalAt = secondRide[0].arrivalAt,
    )

    /** The same pair on a single ride, to stand beside [journey] as a second option. */
    val directJourney = journey.copy(
        legs = journey.legs.take(1),
        transferCount = 0,
        labels = listOf(JourneyLabel.LEAST_WALKING),
        boardings = 1,
        walkDistanceM = 0,
        arrivalAt = firstRide[0].arrivalAt,
    )

    val routeBar = listOf(
        RouteBarSegment.Ride(50_000, 0.92, listOf("#E4002B"), "B", "Commuter Line Bogor", "KCI"),
        RouteBarSegment.Walk(80),
        RouteBarSegment.Ride(4_000, 0.08, listOf("#00A9E0"), "C", "Commuter Line Cikarang", "KCI"),
    )
}
