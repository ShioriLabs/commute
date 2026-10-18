package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.runtime.FinishedTrip
import java.time.Instant

/** Sample trips for the trip `@Preview`s: Bogor to Sudirman by Commuter Line, one change at Manggarai. */
internal object TripPreviewData {

    val lines = mapOf(
        "KCI:BOO" to LineInfo("Commuter Line Bogor", "B", "#E4002B", "KCI"),
        "KCI:CKR" to LineInfo("Commuter Line Cikarang", "C", "#00A9E0", "KCI"),
    )

    val stationLines = mapOf(
        "KCI-MRI" to listOf("KCI:BOO", "KCI:CKR"),
        "KCI-SUD" to listOf("KCI:CKR"),
    )

    private val origin = Route.Trip(fromId = "KCI-BOO", toId = "KCI-SUD", journeyKey = "B.BOO-MRI|C.MRI-SUD")

    private fun stop(id: String, name: String, k: Int, at: Instant) =
        TripStop(id, name, -6.60 + 0.045 * k, 106.80 + 0.01 * k, scheduledAt = at)

    /** Departing a few minutes from [now], so the board has minutes to count down. */
    private fun plan(now: Instant): TripPlan {
        val first = now.plusSeconds(4 * 60)
        val bogor = listOf("Bogor", "Cilebut", "Citayam", "Depok", "Pasar Minggu", "Manggarai")
            .mapIndexed { k, name -> stop("KCI-B$k", name, k, first.plusSeconds(k * 9 * 60L)) }
        val change = first.plusSeconds(54 * 60)
        val cikarang = listOf("Manggarai", "Sudirman")
            .mapIndexed { k, name -> stop(if (k == 0) "KCI-MRI" else "KCI-SUD", name, 6 + k, change.plusSeconds(k * 8 * 60L)) }
        return TripPlan(
            listOf(
                TripLeg.Ride("KCI:BOO", "KCI", "Jakarta Kota", "3", bogor, first, first.plusSeconds(45 * 60)),
                TripLeg.Transfer(bogor.last(), cikarang.first(), distanceM = 80),
                TripLeg.Ride("KCI:CKR", "KCI", "Cikarang", null, cikarang, change, change.plusSeconds(8 * 60)),
            ),
        )
    }

    /** Waiting on the platform for the first train. */
    fun waiting(now: Instant = Instant.now()): ActiveTrip {
        val plan = plan(now)
        return ActiveTrip(plan, TripEngine.start(plan, now, hasLocation = true).state, origin)
    }

    /** On the first train, [position] stops along. */
    fun riding(now: Instant = Instant.now(), position: Double = 2.5): ActiveTrip {
        val trip = waiting(now)
        return trip.copy(state = trip.state.copy(phase = TripPhase.RIDING, position = position, confirmedPosition = position))
    }

    fun finished(now: Instant = Instant.now(), reason: FinishReason = FinishReason.ARRIVED): FinishedTrip {
        val plan = plan(now)
        val last = plan.rideIndices.last()
        val state = TripEngine.start(plan, now, hasLocation = true).state
            .copy(legIndex = last, phase = TripPhase.ARRIVED, position = 1.0, confirmedPosition = 1.0, arrivedAt = now.plusSeconds(62 * 60))
        return FinishedTrip(ActiveTrip(plan, state, origin), reason, now.plusSeconds(64 * 60))
    }
}
