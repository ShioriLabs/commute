package id.shiorilabs.commute.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripLocationMode
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.core.wearable.WearLine
import id.shiorilabs.commute.core.wearable.WearTrip
import kotlinx.coroutines.flow.flowOf
import java.time.Instant

/**
 * The trip screen on a made-up trip, picked by the `scene` extra: `board`, `ride`, `alight`,
 * `change`, `busboard`, `bus` or `busalight`. Debug builds only, for looking at the screen on an
 * emulator with no phone paired.
 */
class DemoActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val trip = demoTrip(intent.getStringExtra("scene") ?: "ride", Instant.now())
        setContent { WatchApp(flowOf(trip), PhoneLink(this)) }
    }
}

private fun demoTrip(scene: String, now: Instant): WearTrip {
    fun at(minutes: Long) = now.plusSeconds(minutes * 60)
    fun stop(id: String, name: String, minutes: Long?) = TripStop(id, name, scheduledAt = minutes?.let(::at))

    val bogor = TripLeg.Ride(
        line = "KCI:B",
        operator = "KCI",
        headsign = "Bogor",
        platformCode = "6/7",
        stops = listOf(
            stop("KCI-MRI", "Manggarai", 4),
            stop("KCI-TEB", "Tebet", 7),
            stop("KCI-CW", "Cawang", 10),
            stop("KCI-DRN", "Duren Kalibata", 13),
            stop("KCI-PSM", "Pasar Minggu", 16),
        ),
        departureAt = at(4),
        arrivalAt = at(16),
    )
    val mrt = TripLeg.Ride(
        line = "MRTJ:M",
        operator = "MRTJ",
        headsign = "Lebak Bulus Grab",
        stops = listOf(
            stop("MRTJ-DKA", "Dukuh Atas BNI", 75),
            stop("MRTJ-SET", "Setiabudi Astra", 77),
            stop("MRTJ-IST", "Istora Mandiri", 80),
        ),
        departureAt = at(75),
        arrivalAt = at(80),
    )
    // Untimed, as most TransJakarta rides are: no minutes to give, so stops and the place lead.
    val bus = TripLeg.Ride(
        line = "TJ:9",
        operator = "TJ",
        headsign = "Pluit",
        stops = listOf("Cawang Ciliwung", "Cikoko", "Pancoran", "Tegal Parang", "Kuningan Barat", "Gatot Subroto Jamsostek", "Semanggi", "Slipi Petamburan")
            .mapIndexed { i, name -> stop("TJ-$i", name, null) },
    )
    val lines = mapOf(
        "KCI:B" to WearLine("Lin Bogor", 0xFFEE3D43.toInt()),
        "MRTJ:M" to WearLine("Lin Utara Selatan", 0xFFCA2A51.toInt()),
        "TJ:9" to WearLine("Pinang Ranti - Pluit", 0xFF45A49E.toInt()),
    )
    fun state(legIndex: Int, phase: TripPhase, position: Double, source: PositionSource = PositionSource.CONFIRMED) = TripState(
        legIndex = legIndex,
        phase = phase,
        confirmedPosition = position,
        position = position,
        source = source,
        confirmedAt = now,
        hasLocation = true,
        locationMode = TripLocationMode.PRECISE,
        startedAt = at(-5),
    )
    val twoRides = TripPlan(
        listOf(
            bogor.copy(stops = bogor.stops.take(3)),
            TripLeg.Transfer(TripStop("KCI-SUD", "Sudirman"), TripStop("MRTJ-DKA", "Dukuh Atas BNI"), distanceM = 350),
            mrt,
        ),
    )
    return when (scene) {
        "board" -> WearTrip(TripPlan(listOf(bogor)), state(0, TripPhase.WAITING_TO_BOARD, 0.0), lines)
        "busboard" -> WearTrip(TripPlan(listOf(bus)), state(0, TripPhase.WAITING_TO_BOARD, 0.0), lines)
        "bus" -> WearTrip(TripPlan(listOf(bus)), state(0, TripPhase.RIDING, 2.4), lines)
        "busalight" -> WearTrip(TripPlan(listOf(bus)), state(0, TripPhase.RIDING, 7.0), lines)
        "alight" -> WearTrip(TripPlan(listOf(bogor)), state(0, TripPhase.RIDING, 4.0), lines)
        "change" -> WearTrip(twoRides, state(2, TripPhase.WAITING_TO_BOARD, 0.0), lines)
        else -> WearTrip(TripPlan(listOf(bogor)), state(0, TripPhase.RIDING, 1.3), lines)
    }
}
