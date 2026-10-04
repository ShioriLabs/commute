package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import java.time.Instant

/** Stations close to where they really are; the engine only needs them a believable distance apart. */
internal object Places {
    // Commuter Line, Bogor line southbound: surface, about 1.5–2.5 km apart.
    val MANGGARAI = stop("KCI-MRI", "Manggarai", -6.2099, 106.8502)
    val TEBET = stop("KCI-TEB", "Tebet", -6.2261, 106.8583)
    val CAWANG = stop("KCI-CW", "Cawang", -6.2427, 106.8588)
    val DUREN_KALIBATA = stop("KCI-DRN", "Duren Kalibata", -6.2554, 106.8550)
    val PASAR_MINGGU_BARU = stop("KCI-PSMB", "Pasar Minggu Baru", -6.2627, 106.8516)
    val PASAR_MINGGU = stop("KCI-PSM", "Pasar Minggu", -6.2843, 106.8445)

    // MRT, underground stretch southbound.
    val BUNDARAN_HI = stop("MRTJ-BHI", "Bundaran HI", -6.1913, 106.8230)
    val DUKUH_ATAS = stop("MRTJ-DKA", "Dukuh Atas BNI", -6.2007, 106.8227)
    val SETIABUDI = stop("MRTJ-SET", "Setiabudi Astra", -6.2090, 106.8217)
    val BENHIL = stop("MRTJ-BNH", "Bendungan Hilir", -6.2149, 106.8180)
    val ISTORA = stop("MRTJ-IST", "Istora Mandiri", -6.2224, 106.8087)

    val SUDIRMAN = stop("KCI-SUD", "Sudirman", -6.2024, 106.8237)

    // TransJakarta haltes, about 500 m apart.
    val HALTE_1 = stop("TJ-H1", "Halte Satu", -6.2000, 106.8300)
    val HALTE_2 = stop("TJ-H2", "Halte Dua", -6.2045, 106.8300)
    val HALTE_3 = stop("TJ-H3", "Halte Tiga", -6.2090, 106.8300)
    val HALTE_4 = stop("TJ-H4", "Halte Empat", -6.2135, 106.8300)

    private fun stop(id: String, name: String, lat: Double, lon: Double) = TripStop(id, name, lat, lon)
}

internal val BASE: Instant = Instant.parse("2026-10-04T01:00:00Z") // 08.00 WIB

internal fun at(minutes: Double): Instant = BASE.plusMillis((minutes * 60_000).toLong())

internal fun at(minutes: Int): Instant = at(minutes.toDouble())

internal val TripStop.here: GeoPoint get() = point!!

internal fun between(a: TripStop, b: TripStop, fraction: Double) = GeoPoint(
    a.latitude!! + (b.latitude!! - a.latitude) * fraction,
    a.longitude!! + (b.longitude!! - a.longitude) * fraction,
)

internal fun ride(
    vararg stops: TripStop,
    line: String = "KCI:C",
    operator: String = line.substringBefore(':'),
    departs: Int? = null,
    arrives: Int? = null,
) = TripLeg.Ride(
    line = line,
    operator = operator,
    headsign = "Bogor",
    stops = stops.toList(),
    departureAt = departs?.let(::at),
    arrivalAt = arrives?.let(::at),
)

/** Manggarai to Pasar Minggu, 08.00 to 08.16. */
internal val bogorLine = TripPlan(
    listOf(
        ride(
            Places.MANGGARAI, Places.TEBET, Places.CAWANG, Places.DUREN_KALIBATA, Places.PASAR_MINGGU_BARU,
            Places.PASAR_MINGGU,
            departs = 0, arrives = 16,
        ),
    ),
)

/** Bundaran HI to Istora underground, 08.00 to 08.10. */
internal val mrt = TripPlan(
    listOf(
        ride(
            Places.BUNDARAN_HI, Places.DUKUH_ATAS, Places.SETIABUDI, Places.BENHIL, Places.ISTORA,
            line = "MRTJ:M", departs = 0, arrives = 10,
        ),
    ),
)

/** Four haltes on one corridor, no timetable. */
internal val busway = TripPlan(
    listOf(ride(Places.HALTE_1, Places.HALTE_2, Places.HALTE_3, Places.HALTE_4, line = "TJ:1")),
)

/** MRT to Dukuh Atas, a walk to Sudirman, then the Commuter Line on to Manggarai. */
internal val withChange = TripPlan(
    listOf(
        ride(Places.BUNDARAN_HI, Places.DUKUH_ATAS, line = "MRTJ:M", departs = 0, arrives = 2),
        TripLeg.Transfer(Places.DUKUH_ATAS, Places.SUDIRMAN, distanceM = 300),
        ride(Places.SUDIRMAN, Places.MANGGARAI, line = "KCI:B", departs = 10, arrives = 15),
    ),
)

/** Runs [events] from a start at [startAt], collecting every effect. */
internal class Run(val plan: TripPlan, startAt: Instant = at(-2), hasLocation: Boolean = true) {

    var step: TripStep = TripEngine.start(plan, startAt, hasLocation)
        private set

    val effects = step.effects.toMutableList()

    val state: TripState get() = step.state

    fun send(event: TripEvent): TripStep {
        step = TripEngine.step(plan, step.state, event)
        effects += step.effects
        return step
    }

    fun fix(point: GeoPoint, minutes: Double, accuracyM: Float = 20f) =
        send(TripEvent.Fix(point, accuracyM, at(minutes)))

    fun fix(stop: TripStop, minutes: Double, accuracyM: Float = 20f) = fix(stop.here, minutes, accuracyM)

    fun tick(minutes: Double) = send(TripEvent.Tick(at(minutes)))

    fun alerts(): List<TripEffect.Alert> = effects.filterIsInstance<TripEffect.Alert>()
}
