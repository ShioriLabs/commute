package id.shiorilabs.commute.feature.trip

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import java.time.Instant

internal val NOW: Instant = Instant.parse("2026-10-04T01:00:00Z")

internal fun minutes(m: Long): Instant = NOW.plusSeconds(m * 60)

internal val MANGGARAI = TripStop("KCI-MRI", "Manggarai", -6.2099, 106.8502)
internal val TEBET = TripStop("KCI-TEB", "Tebet", -6.2261, 106.8583)
internal val CAWANG = TripStop("KCI-CW", "Cawang", -6.2427, 106.8588)
internal val DUKUH_ATAS = TripStop("MRTJ-DKA", "Dukuh Atas BNI", -6.2007, 106.8227)
internal val SUDIRMAN = TripStop("KCI-SUD", "Sudirman", -6.2024, 106.8237)

/** Sudirman to Cawang: a walk from the MRT, then the Commuter Line. */
internal val plan = TripPlan(
    listOf(
        TripLeg.Ride("MRTJ:M", "MRTJ", "Lebak Bulus", null, listOf(TripStop("MRTJ-BHI", "Bundaran HI", -6.1913, 106.8230), DUKUH_ATAS), minutes(0), minutes(2)),
        TripLeg.Transfer(DUKUH_ATAS, SUDIRMAN, distanceM = 300),
        TripLeg.Ride("KCI:B", "KCI", "Manggarai", "2", listOf(SUDIRMAN, MANGGARAI, TEBET, CAWANG), minutes(10), minutes(20)),
    ),
)

internal val origin = Route.Trip(fromId = "MRTJ-BHI", toId = "KCI-CW", journeyKey = "M.BHI-DKA|B.SUD-CW")
