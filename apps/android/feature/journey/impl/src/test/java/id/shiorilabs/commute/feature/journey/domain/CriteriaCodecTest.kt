package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.core.datastore.StoredFareCriteria
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class CriteriaCodecTest {

    private val now = Instant.parse("2026-10-05T01:47:00Z")
    private val later = Instant.parse("2026-10-05T03:20:00Z")

    @Test
    fun `a default search sends nothing`() {
        assertEquals(TripQueryParams(), tripQueryParams(JourneyCriteria()))
    }

    @Test
    fun `stored criteria round-trip`() {
        val criteria = JourneyCriteria(PaymentMethod.QRIS_TAP, Departure.At(later), Modes.RAIL, WalkingSpeed.BRISK)

        assertEquals(criteria, criteria.toStored().toCriteria(now))
    }

    @Test
    fun `one unreadable stored field resets only itself`() {
        val stored = StoredFareCriteria(paymentMethod = "JAKLINGKO", fareTime = "garbage", modes = "rail", walking = "AVOID")

        assertEquals(
            JourneyCriteria(PaymentMethod.STORED_VALUE, Departure.Now, Modes.RAIL, WalkingSpeed.SLOWEST),
            stored.toCriteria(now),
        )
        assertEquals(JourneyCriteria(), null.toCriteria(now))
    }

    @Test
    fun `a stored departure that has gone by reads as now`() {
        val stored = StoredFareCriteria(fareTime = "2026-10-05T01:00:00Z")

        assertEquals(Departure.Now, stored.toCriteria(now).departure)
    }

    @Test
    fun `a link overrides only what it carries`() {
        val own = JourneyCriteria(paymentMethod = PaymentMethod.QRIS_TAP, walking = WalkingSpeed.SLOW)

        val linked = own.withLink(paymentMethod = null, at = "2026-10-05T10:20:00+07:00", modes = "rail", walking = "nope", now = now)

        assertEquals(JourneyCriteria(PaymentMethod.QRIS_TAP, Departure.At(later), Modes.RAIL, WalkingSpeed.SLOW), linked)
    }

    @Test
    fun `criteria spelled out in full win over the rider's own, defaults included`() {
        val own = JourneyCriteria(PaymentMethod.QRIS_TAP, Departure.At(later), Modes.RAIL, WalkingSpeed.SLOW)

        listOf(
            JourneyCriteria(),
            JourneyCriteria(PaymentMethod.STORED_VALUE, Departure.At(later), Modes.ALL, WalkingSpeed.BRISK),
        ).forEach { opened ->
            val params = opened.toLinkParams()
            assertEquals(opened, own.withLink(params.paymentMethod, params.at, params.modes, params.walking, now))
        }
    }

    @Test
    fun `the share link matches the web's`() {
        assertEquals(
            "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB",
            fareShareUrl("KCI-SUD", "MRTJ-LBB", JourneyCriteria(), null),
        )
        assertEquals(
            "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB&paymentMethod=QRIS_TAP&at=2026-10-05T03%3A20%3A00Z&modes=rail&j=C.SUD-MRI%7E_DKA",
            fareShareUrl(
                "KCI-SUD",
                "MRTJ-LBB",
                JourneyCriteria(PaymentMethod.QRIS_TAP, Departure.At(later), Modes.RAIL),
                "C.SUD-MRI~_DKA",
            ),
        )
        assertNull(fareShareUrl(null, "MRTJ-LBB", JourneyCriteria(), null))
    }
}
