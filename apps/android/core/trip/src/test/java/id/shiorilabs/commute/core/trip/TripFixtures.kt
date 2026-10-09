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

    // LRT Jabodebek, Setiabudi to Dukuh Atas: one hop of about 710 m. Dukuh Atas sits about 270 m
    // along the Commuter Line out of Sudirman, and 330 m from Sudirman itself.
    val LRT_SETIABUDI = stop("LRTJBDB-SET", "Setiabudi", -6.2092, 106.8302)
    val LRT_DUKUH_ATAS = stop("LRTJBDB-DKA", "Dukuh Atas BSI", -6.2047, 106.8256)

    // TransJakarta haltes, about 500 m apart.
    val HALTE_1 = stop("TJ-H1", "Halte Satu", -6.2000, 106.8300)
    val HALTE_2 = stop("TJ-H2", "Halte Dua", -6.2045, 106.8300)
    val HALTE_3 = stop("TJ-H3", "Halte Tiga", -6.2090, 106.8300)
    val HALTE_4 = stop("TJ-H4", "Halte Empat", -6.2135, 106.8300)

    // L13E toward CSW, where they are: the road from Underpass Kuningan runs down Mampang to Tendean
    // and back east to Tegal Mampang (1.4 km against a 645 m hop), under the hop on to CSW 1.
    val UNDERPASS_KUNINGAN = stop("TJ-H00115P", "Underpass Kuningan", -6.234731, 106.82902)
    val TEGAL_MAMPANG = stop("TJ-H00246P", "Tegal Mampang", -6.240213, 106.83102)
    val CSW_1 = stop("TJ-H00041P", "CSW 1", -6.23994, 106.79843)

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

/** L13E's last three haltes, untimed. */
internal val toCsw = TripPlan(
    listOf(ride(Places.UNDERPASS_KUNINGAN, Places.TEGAL_MAMPANG, Places.CSW_1, line = "TJ:L13E")),
)

/** MRT to Dukuh Atas, a walk to Sudirman, then the Commuter Line on to Manggarai. */
internal val withChange = TripPlan(
    listOf(
        ride(Places.BUNDARAN_HI, Places.DUKUH_ATAS, line = "MRTJ:M", departs = 0, arrives = 2),
        TripLeg.Transfer(Places.DUKUH_ATAS, Places.SUDIRMAN, distanceM = 300),
        ride(Places.SUDIRMAN, Places.MANGGARAI, line = "KCI:B", departs = 10, arrives = 15),
    ),
)

/** The LRT from Setiabudi to Dukuh Atas, a walk to Sudirman, then the Commuter Line to Manggarai. */
internal val lrtThenKrl = TripPlan(
    listOf(
        ride(Places.LRT_SETIABUDI, Places.LRT_DUKUH_ATAS, line = "LRTJBDB:BK", departs = 0, arrives = 2),
        TripLeg.Transfer(Places.LRT_DUKUH_ATAS, Places.SUDIRMAN, distanceM = 330),
        ride(Places.SUDIRMAN, Places.MANGGARAI, line = "KCI:C", departs = 10, arrives = 15),
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

    fun fix(point: GeoPoint, minutes: Double, accuracyM: Float = 20f, speedMps: Float? = null) =
        send(TripEvent.Fix(point, accuracyM, at(minutes), speedMps))

    fun fix(stop: TripStop, minutes: Double, accuracyM: Float = 20f, speedMps: Float? = null) =
        fix(stop.here, minutes, accuracyM, speedMps)

    fun tick(minutes: Double) = send(TripEvent.Tick(at(minutes)))

    fun alerts(): List<TripEffect.Alert> = effects.filterIsInstance<TripEffect.Alert>()
}

/** [points] as the API's track shapes write them: Google's encoded polyline, precision 5. */
internal fun encodePolyline(vararg points: GeoPoint): String {
    val out = StringBuilder()
    var lat = 0
    var lng = 0
    fun put(delta: Int) {
        var v = if (delta < 0) (delta shl 1).inv() else delta shl 1
        while (v >= 0x20) {
            out.append(((0x20 or (v and 0x1f)) + 63).toChar())
            v = v shr 5
        }
        out.append((v + 63).toChar())
    }
    for (p in points) {
        val iLat = Math.round(p.latitude * 1e5).toInt()
        val iLng = Math.round(p.longitude * 1e5).toInt()
        put(iLat - lat)
        put(iLng - lng)
        lat = iLat
        lng = iLng
    }
    return out.toString()
}

/** [this] with its hops' shapes, one per hop, `null` for the straight line. */
internal fun TripPlan.shaped(vararg hops: List<GeoPoint>?) = TripPlan(
    legs.map { leg ->
        if (leg is TripLeg.Ride) leg.copy(hopShapes = hops.map { it?.let { points -> encodePolyline(*points.toTypedArray()) } }) else leg
    },
)
