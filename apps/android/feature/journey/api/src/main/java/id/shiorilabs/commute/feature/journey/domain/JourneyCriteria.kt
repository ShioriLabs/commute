package id.shiorilabs.commute.feature.journey.domain

import java.time.Instant

/**
 * What the OTW search asks for besides the pair: the web's `FareCriteria`, less `operator`, which
 * only ever arrives on a web link and scopes that page's picker.
 */
data class JourneyCriteria(
    val paymentMethod: PaymentMethod = PaymentMethod.STORED_VALUE,
    val departure: Departure = Departure.Now,
    val modes: Modes = Modes.ALL,
    val walking: WalkingSpeed = WalkingSpeed.AVERAGE,
)

/**
 * How the rider pays. JakLingko is absent on purpose, as on the web: its integrated fare is known to
 * be computed wrong, so it is not offered until that is fixed.
 */
enum class PaymentMethod { STORED_VALUE, QRIS_TAP }

sealed interface Departure {

    /** Follows the clock. */
    data object Now : Departure

    /** A picked departure, on a [DEPARTURE_SLOT_MINUTES] boundary. */
    data class At(val instant: Instant) : Departure
}

/** Which networks a route may use. */
enum class Modes { ALL, RAIL }

/** How fast the rider walks: it decides which connections they make and how much a walk costs. */
enum class WalkingSpeed { BRISK, AVERAGE, SLOW, SLOWEST }

/** The API keys journey answers on this grid (its `DEPARTURE_SLOT_MINUTES`). */
const val DEPARTURE_SLOT_MINUTES = 20
