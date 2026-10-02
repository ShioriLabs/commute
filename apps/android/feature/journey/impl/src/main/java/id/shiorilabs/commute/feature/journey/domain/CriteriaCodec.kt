package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.core.datastore.StoredFareCriteria
import java.net.URLEncoder
import java.time.Instant
import java.time.OffsetDateTime

/*
 * The criteria to and from their wire, storage and link forms: the web's `utils/fare-criteria.ts`
 * and `utils/fare-url.ts`. Field by field throughout, like the server's `parseFareContext`: one
 * value this version does not recognise resets only itself.
 */

private const val NOW = "now"

/** Where a shared link points: the web's `/fare` page, which this app also opens. */
const val FARE_SHARE_BASE_URL = "https://commute.shiorilabs.id/fare"

/** The query params of one trips request; `null` is the server's default, and is not sent. */
data class TripQueryParams(
    val paymentMethod: String? = null,
    val at: String? = null,
    val modes: String? = null,
    val walking: String? = null,
)

/**
 * Defaults are left out rather than spelled, which keeps a default search on the same cache entry
 * the web warms, and a shared link at `?from=&to=` unless the sender changed something.
 */
fun tripQueryParams(criteria: JourneyCriteria): TripQueryParams {
    val defaults = JourneyCriteria()
    return TripQueryParams(
        paymentMethod = criteria.paymentMethod.takeIf { it != defaults.paymentMethod }?.name,
        at = (criteria.departure as? Departure.At)?.instant?.toString(),
        modes = if (criteria.modes == Modes.RAIL) "rail" else null,
        walking = criteria.walking.takeIf { it != defaults.walking }?.name,
    )
}

fun JourneyCriteria.toStored(): StoredFareCriteria = StoredFareCriteria(
    paymentMethod = paymentMethod.name,
    fareTime = when (val departure = departure) {
        Departure.Now -> NOW
        is Departure.At -> departure.instant.toString()
    },
    modes = if (modes == Modes.RAIL) "rail" else "all",
    walking = walking.name,
)

/** Stored settings back, each falling to its default on its own. A departure gone by reads as now. */
fun StoredFareCriteria?.toCriteria(now: Instant): JourneyCriteria {
    if (this == null) {
        return JourneyCriteria()
    }
    val defaults = JourneyCriteria()
    return JourneyCriteria(
        paymentMethod = parsePaymentMethod(paymentMethod) ?: defaults.paymentMethod,
        departure = parseDeparture(fareTime, now) ?: defaults.departure,
        modes = if (modes == "rail") Modes.RAIL else defaults.modes,
        walking = parseWalking(walking) ?: defaults.walking,
    )
}

/**
 * Criteria a shared link names, laid over the rider's own for that visit. Only what the link
 * carries changes; a value it carries but this version cannot read leaves the rider's own in place.
 */
fun JourneyCriteria.withLink(
    paymentMethod: String?,
    at: String?,
    modes: String?,
    walking: String?,
    now: Instant,
): JourneyCriteria = copy(
    paymentMethod = parsePaymentMethod(paymentMethod) ?: this.paymentMethod,
    departure = parseDeparture(at, now)?.takeIf { it is Departure.At } ?: departure,
    modes = if (modes == "rail") Modes.RAIL else this.modes,
    walking = parseWalking(walking) ?: this.walking,
)

/**
 * The web link for a pair, as the web's `buildFareShareUrl` writes it, so it opens the same answer
 * there or in this app. `null` without both ends.
 */
fun fareShareUrl(fromId: String?, toId: String?, criteria: JourneyCriteria, journeyKey: String?): String? {
    if (fromId == null || toId == null) {
        return null
    }
    val query = tripQueryParams(criteria)
    val params = listOfNotNull(
        "from" to fromId,
        "to" to toId,
        query.paymentMethod?.let { "paymentMethod" to it },
        query.at?.let { "at" to it },
        query.modes?.let { "modes" to it },
        query.walking?.let { "walking" to it },
        journeyKey?.let { "j" to it },
    )
    return FARE_SHARE_BASE_URL + "?" + params.joinToString("&") { (key, value) ->
        key + "=" + URLEncoder.encode(value, Charsets.UTF_8)
    }
}

private fun parsePaymentMethod(raw: String?): PaymentMethod? = PaymentMethod.entries.firstOrNull { it.name == raw }

/**
 * `AVOID` is the retired fourth level, which ranked as SLOWEST does now, so a stored setting or an
 * old link that carries it lands there rather than on the default. The API reads it the same way.
 */
private fun parseWalking(raw: String?): WalkingSpeed? =
    if (raw == "AVOID") WalkingSpeed.SLOWEST else WalkingSpeed.entries.firstOrNull { it.name == raw }

/** `now`, or an instant still ahead, quantised; anything unreadable or gone by reads as now. */
private fun parseDeparture(raw: String?, now: Instant): Departure? {
    if (raw == null) {
        return null
    }
    if (raw == NOW) {
        return Departure.Now
    }
    val instant = runCatching { OffsetDateTime.parse(raw).toInstant() }.getOrNull() ?: return Departure.Now
    val departure = Departure.At(quantiseToSlot(instant))
    return if (isStaleDeparture(departure, now)) Departure.Now else departure
}
