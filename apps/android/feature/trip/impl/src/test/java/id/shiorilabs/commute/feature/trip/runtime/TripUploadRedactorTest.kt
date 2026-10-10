package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.minutes
import id.shiorilabs.commute.feature.trip.origin
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TripUploadRedactorTest {

    /** Cakung to Sudirman on the C line, about a kilometre a stop, westward. */
    private val cLine = listOf("Cakung", "Klender Baru", "Klender", "Jatinegara", "Manggarai", "Sudirman")
        .mapIndexed { k, name -> TripStop("KCI-C$k", name, -6.2, 106.90 - 0.01 * k) }

    /** Dukuh Atas BSI south to Kuningan, a short walk from Sudirman. */
    private val bkLine = listOf("Dukuh Atas BSI", "Setiabudi", "Kuningan")
        .mapIndexed { k, name -> TripStop("TJ-B$k", name, -6.201 - 0.01 * k, 106.85) }

    /** Seven stops end to end: five on the C line, then two on the bus after the change. */
    private val plan = TripPlan(
        listOf(
            TripLeg.Ride("KCI:C", "KCI", "Tanah Abang", null, cLine, minutes(0), minutes(20)),
            TripLeg.Transfer(cLine.last(), bkLine.first(), distanceM = 150),
            TripLeg.Ride("TJ:BK", "TJ", "Ragunan", null, bkLine, minutes(25), minutes(32)),
        ),
    )

    private val journey = origin.journeyKey

    private fun finished(reason: FinishReason = FinishReason.ARRIVED, leg: Int = 2, position: Double = 2.0, plan: TripPlan = this.plan): FinishedTrip {
        val state = TripEngine.start(plan, NOW, hasLocation = true).state
            .copy(legIndex = leg, phase = TripPhase.RIDING, position = position, confirmedPosition = position)
        return FinishedTrip(ActiveTrip(plan, state, origin), reason, minutes(40))
    }

    private fun event(name: String, fields: Map<String, Any?>) = line("2026-10-04T08:00:00.000+07:00", name, fields).trimEnd('\n')

    /** A fix at [stop] (or nudged off it by [northM]), as the trip's step logged it. */
    private fun fix(leg: Int, pos: Double, stop: TripStop, northM: Double = 0.0, phase: TripPhase = TripPhase.RIDING) = event(
        "fix",
        mapOf(
            "lat" to stop.latitude!! + northM / 111_000,
            "lon" to stop.longitude,
            "acc" to 8f,
            "speed" to 10f,
            "leg" to leg,
            "phase" to phase,
            "pos" to pos,
            "confirmed" to pos,
            "src" to "CONFIRMED",
            "offsetS" to 30,
            "walking" to false,
        ),
    )

    private fun parsed(lines: List<String>?): List<JsonObject> = lines!!.map { Json.parseToJsonElement(it).jsonObject }

    private fun JsonObject.ev() = getValue("ev").jsonPrimitive.content

    private fun JsonObject.pos() = getValue("pos").jsonPrimitive.double

    private val oneEach = TripUploadRedactor.Trims(start = 1, end = 1)

    private val tripLines = listOf(
        event("started", mapOf("journey" to journey, "location" to true)),
        // At home, then on the way to Cakung, then between Cakung and Klender Baru.
        fix(0, 0.0, cLine[0], northM = 2_000.0, phase = TripPhase.WAITING_TO_BOARD),
        fix(0, 0.5, cLine[0]),
        fix(0, 1.0, cLine[1]),
        event("imu", mapOf("v" to 9.5, "fix" to false)),
        event("alert", mapOf("kind" to "PREPARE", "leg" to 0, "estimated" to false)),
        event(
            "mark",
            mapOf("kind" to "stop", "boardLabel" to "ALIGHT_NEXT", "boardStation" to "Jatinegara", "boardStopsLeft" to 2, "boardMinutesLeft" to 3, "leg" to 0, "pos" to 3.0),
        ),
        // A fix half a kilometre off the line.
        fix(0, 3.2, cLine[3], northM = 500.0),
        fix(2, 0.0, bkLine[0], phase = TripPhase.WAITING_TO_BOARD),
        fix(2, 1.0, bkLine[1]),
        // Past Setiabudi, towards where the rider got off.
        fix(2, 1.5, bkLine[1]),
        fix(2, 2.0, bkLine[2], phase = TripPhase.ARRIVED),
        event("finished", mapOf("journey" to journey, "reason" to "ARRIVED")),
    )

    @Test
    fun `only this trip's lines go, between a stop in from each end`() {
        val before = listOf(
            event("started", mapOf("journey" to "earlier", "location" to true)),
            fix(0, 2.0, cLine[2]),
            event("finished", mapOf("journey" to "earlier", "reason" to "ARRIVED")),
        )
        val after = listOf(event("started", mapOf("journey" to "later", "location" to true)), fix(0, 2.0, cLine[2]))

        val sent = parsed(TripUploadRedactor.redact(before + tripLines + after, finished(), oneEach))

        assertEquals(listOf("plan", "fix", "imu", "mark", "fix", "fix"), sent.map { it.ev() })
        // Klender Baru, the first stop kept, is stop 0 of what's sent.
        val first = sent[1]
        assertEquals(0.0, first.pos(), 0.0)
        assertEquals(cLine[1].latitude!!, first.getValue("lat").jsonPrimitive.double, 1e-9)
        // Dukuh Atas BSI and Setiabudi, on the bus after the walk, legs as they were.
        assertEquals(listOf(2, 2), sent.takeLast(2).map { it.getValue("leg").jsonPrimitive.int })
        assertEquals(listOf(0.0, 1.0), sent.takeLast(2).map { it.pos() })
        assertTrue(sent.none { "journey" in it })
    }

    @Test
    fun `a mark loses what counts down to getting off`() {
        val mark = parsed(TripUploadRedactor.redact(tripLines, finished(), oneEach)).single { it.ev() == "mark" }

        assertEquals("NEXT", mark.getValue("boardLabel").jsonPrimitive.content)
        assertEquals("Jatinegara", mark.getValue("boardStation").jsonPrimitive.content)
        assertFalse("boardStopsLeft" in mark)
        assertFalse("boardMinutesLeft" in mark)
        assertEquals(2.0, mark.pos(), 0.0)
    }

    @Test
    fun `the plan names only the stops kept, and no times at a stop cut`() {
        val legs = parsed(TripUploadRedactor.redact(tripLines, finished(), oneEach)).first().getValue("legs").jsonArray

        assertEquals(listOf("RIDE", "TRANSFER", "RIDE"), legs.map { it.jsonObject.getValue("type").jsonPrimitive.content })
        val c = legs[0].jsonObject
        assertEquals(cLine.drop(1).map { it.name }, (c.getValue("stops") as JsonArray).map { it.jsonObject.getValue("name").jsonPrimitive.content })
        assertEquals(JsonNull, c.getValue("departureAt"))
        val bk = legs[2].jsonObject
        assertEquals(bkLine.take(2).map { it.name }, (bk.getValue("stops") as JsonArray).map { it.jsonObject.getValue("name").jsonPrimitive.content })
        assertEquals(JsonNull, bk.getValue("arrivalAt"))
        assertTrue(legs.none { "Cakung" in it.toString() || "Kuningan" in it.toString() })
    }

    @Test
    fun `two off each end can leave a ride out, the legs renumbered over the rest`() {
        val sent = parsed(TripUploadRedactor.redact(tripLines, finished(), TripUploadRedactor.Trims(start = 2, end = 2)))

        val legs = sent.first().getValue("legs").jsonArray
        assertEquals(1, legs.size)
        assertEquals(cLine.subList(2, 6).map { it.name }, legs[0].jsonObject.getValue("stops").jsonArray.map { it.jsonObject.getValue("name").jsonPrimitive.content })
        // Only the mark at Jatinegara is left: Klender Baru is cut now, the bus is gone.
        assertEquals(listOf("plan", "mark"), sent.map { it.ev() })
        assertEquals(1.0, sent[1].pos(), 0.0)
    }

    @Test
    fun `with the start rotated out of the log, the trip begins after the one before ended`() {
        val rotated = listOf(
            fix(0, 2.0, cLine[2]),
            event("finished", mapOf("journey" to "earlier", "reason" to "ARRIVED")),
        ) + tripLines.drop(1)

        val sent = parsed(TripUploadRedactor.redact(rotated, finished(), oneEach))

        assertEquals(listOf("plan", "fix", "imu", "mark", "fix", "fix"), sent.map { it.ev() })
    }

    @Test
    fun `a trip stopped early ends where the rider got to`() {
        val stopped = finished(FinishReason.STOPPED, leg = 0, position = 5.0)
        val lines = tripLines.take(4) + fix(0, 4.0, cLine[4]) + fix(0, 4.5, cLine[4]) +
            event("finished", mapOf("journey" to journey, "reason" to "STOPPED"))

        val sent = parsed(TripUploadRedactor.redact(lines, stopped, oneEach))

        assertEquals(listOf(0.0, 3.0), sent.drop(1).map { it.pos() })
    }

    @Test
    fun `too short a trip offers nothing`() {
        assertTrue(TripUploadRedactor.eligible(finished()))
        assertTrue(TripUploadRedactor.eligible(finished(FinishReason.STOPPED, leg = 0, position = 5.0)))
        assertFalse(TripUploadRedactor.eligible(finished(FinishReason.STOPPED, leg = 0, position = 4.9)))
        assertNull(TripUploadRedactor.redact(tripLines, finished(FinishReason.STOPPED, leg = 0, position = 4.0), oneEach))
    }

    @Test
    fun `without the trip's own end in the log, nothing goes`() {
        assertNull(TripUploadRedactor.redact(tripLines.dropLast(1), finished(), oneEach))
    }
}
