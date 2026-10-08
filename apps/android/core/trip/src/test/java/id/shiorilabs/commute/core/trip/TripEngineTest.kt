package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TripEngineTest {

    private fun alert(kind: AlertKind, leg: Int = 0, estimated: Boolean) = TripEffect.Alert(kind, leg, estimated)

    @Test
    fun `a surface ride followed by fixes alerts once leaving the stop before and once at it`() {
        val run = Run(bogorLine)

        run.fix(Places.MANGGARAI, -1.0)
        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
        assertEquals(PositionSource.CONFIRMED, run.state.source)

        // On the platform at the scheduled departure: the fix holds the trip, not the clock.
        run.tick(0.5)
        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)

        run.fix(Places.TEBET, 4.0)
        assertEquals(TripPhase.RIDING, run.state.phase)
        assertEquals(1.0, run.state.position, 0.0)

        run.fix(Places.CAWANG, 8.0)
        run.fix(Places.DUREN_KALIBATA, 12.0)
        assertTrue(run.alerts().isEmpty())

        run.fix(Places.PASAR_MINGGU_BARU, 15.0)
        assertTrue(run.alerts().isEmpty())

        run.fix(between(Places.PASAR_MINGGU_BARU, Places.PASAR_MINGGU, 0.2), 16.0)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = false)), run.alerts())

        run.fix(Places.PASAR_MINGGU, 20.0)
        assertEquals(
            listOf(alert(AlertKind.PREPARE, estimated = false), alert(AlertKind.ALIGHT, estimated = false)),
            run.alerts(),
        )
        assertEquals(TripPhase.ARRIVED, run.state.phase)

        run.tick(26.0)
        assertTrue(TripEffect.Finished(FinishReason.ARRIVED) in run.effects)
    }

    @Test
    fun `underground with no fixes the clock carries the trip and every alert says it is an estimate`() {
        val run = Run(mrt, hasLocation = false)
        assertEquals(TripLocationMode.OFF, run.state.locationMode)

        run.tick(0.0)
        assertEquals(TripPhase.RIDING, run.state.phase)
        assertEquals(PositionSource.ESTIMATED, run.state.source)

        run.tick(5.0)
        assertEquals(2.0, run.state.position, 0.3)

        run.tick(8.5)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = true)), run.alerts())

        run.tick(10.0)
        assertEquals(alert(AlertKind.ALIGHT, estimated = true), run.alerts().last())
        // Not arrived until the grace has passed: a fix could still show the train held short.
        assertEquals(TripPhase.RIDING, run.state.phase)

        run.tick(12.0)
        assertEquals(TripPhase.ARRIVED, run.state.phase)
        assertEquals(2, run.alerts().size)
    }

    @Test
    fun `a late train seen at a station is late for the rest of the leg`() {
        val run = Run(bogorLine)
        run.tick(0.0)

        // Tebet is about a fifth of the way along: due near 08.04, seen at 08.07.
        val due = RideClock(bogorLine.ride(0)).scheduledAt(1.0)!!
        run.fix(Places.TEBET, 7.0)
        val late = run.state.clockOffsetS
        assertEquals(java.time.Duration.between(due, at(7)).seconds, late)
        assertTrue(late > 120)

        // Into a cutting with no fixes: by the timetable the train is in, by this train it isn't.
        run.tick(16.0)
        assertFalse(run.alerts().any { it.kind == AlertKind.ALIGHT })
        assertEquals(PositionSource.ESTIMATED, run.state.source)

        run.tick(16.0 + late / 60.0)
        assertEquals(alert(AlertKind.ALIGHT, estimated = true), run.alerts().last())
    }

    @Test
    fun `gps jitter never moves progress back or repeats an alert`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.CAWANG, 8.0)
        run.fix(Places.TEBET, 8.5)
        assertEquals(2.0, run.state.confirmedPosition, 0.0)

        run.fix(Places.PASAR_MINGGU_BARU, 15.0)
        run.fix(between(Places.PASAR_MINGGU_BARU, Places.PASAR_MINGGU, 0.1), 15.1)
        run.fix(between(Places.DUREN_KALIBATA, Places.PASAR_MINGGU_BARU, 0.9), 15.2)
        run.fix(Places.PASAR_MINGGU_BARU, 15.4)

        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = false)), run.alerts())
        assertEquals(4.1, run.state.confirmedPosition, 0.01)
    }

    @Test
    fun `a stop the train runs through without a fix is simply passed`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.TEBET, 4.0)
        run.fix(Places.DUREN_KALIBATA, 11.0)

        assertEquals(3.0, run.state.position, 0.0)
        assertEquals(PositionSource.CONFIRMED, run.state.source)
    }

    @Test
    fun `a fix at a stop records when the train was there, to its last fix while it waits`() {
        val run = Run(bogorLine)
        // On the platform at Manggarai a minute before the train: the rider was there, not it.
        run.fix(Places.MANGGARAI, -1.0)
        assertNull(run.state.seenAt(0, 0))

        run.fix(Places.TEBET, 3.5)
        run.fix(Places.TEBET, 4.0)
        assertEquals(at(4.0), run.state.seenAt(0, 1))

        // Between stops records nothing, and Cawang wasn't seen.
        run.fix(between(Places.CAWANG, Places.DUREN_KALIBATA, 0.5), 7.0)
        assertNull(run.state.seenAt(0, 2))
        assertEquals(at(4.0), run.state.seenAt(0, 1))
    }

    @Test
    fun `the stop to get off at keeps when the train got in`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(between(Places.PASAR_MINGGU_BARU, Places.PASAR_MINGGU, 0.5), 14.0)
        run.fix(Places.PASAR_MINGGU, 15.5)

        assertEquals(at(15.5), run.state.seenAt(0, 5))
    }

    @Test
    fun `boarding and getting off by a tap record their stops too`() {
        val run = Run(withChange)
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0.5)))
        assertEquals(at(0.5), run.state.seenAt(0, 0))

        run.send(TripEvent.RiderSaid(RiderAction.ALIGHTED, at(2.5)))
        assertEquals(at(2.5), run.state.seenAt(0, 1))
    }

    @Test
    fun `a fix on the way in to the last stop isn't arriving yet`() {
        val plan = TripPlan(listOf(ride(Places.MANGGARAI, Places.TEBET, Places.CAWANG, line = "KCI:B", departs = 0, arrives = 10)))
        val run = Run(plan)
        run.tick(0.0)
        // About 185 m short of Cawang, still rolling in.
        run.fix(between(Places.TEBET, Places.CAWANG, 0.9), 8.0)

        assertEquals(TripPhase.RIDING, run.state.phase)
        assertEquals(1.9, run.state.position, 0.05)

        run.fix(Places.CAWANG, 9.0)
        assertEquals(TripPhase.ARRIVED, run.state.phase)
    }

    @Test
    fun `a train still running fast by a station on the way isn't at it until it is about to stop`() {
        val run = Run(bogorLine)
        run.tick(0.0)

        // In Tebet's radius at 50 km/h, then just past its point still braking from 30: rolling in.
        run.fix(Places.TEBET, 4.0, speedMps = 14f)
        assertTrue(run.state.position < 1.0)
        run.fix(between(Places.TEBET, Places.CAWANG, 0.03), 4.1, speedMps = 8.5f)
        assertTrue(run.state.position < 1.0)
        assertNull(run.state.seenAt(0, 1))

        // Down to about 20 km/h, five to ten seconds from standing: in, as the board should say.
        run.fix(between(Places.TEBET, Places.CAWANG, 0.03), 4.2, speedMps = 5.5f)
        assertEquals(1.0, run.state.position, 0.0)
        assertEquals(at(4.2), run.state.seenAt(0, 1))
    }

    @Test
    fun `a train pulling out of a station on the way has left it`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.TEBET, 4.0, speedMps = 0f)

        run.fix(between(Places.TEBET, Places.CAWANG, 0.05), 5.0, speedMps = 8f)
        assertTrue(run.state.position > 1.0)
    }

    @Test
    fun `a train crawling out after standing at a station has left it, two fixes on`() {
        // Jatinegara on 2026-10-06: out at 2 to 4 m/s, held "there" until 235 m out.
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.TEBET, 4.0, speedMps = 0.3f)

        run.fix(between(Places.TEBET, Places.CAWANG, 0.02), 5.0, speedMps = 2.1f)
        assertEquals(1.0, run.state.position, 0.0)
        run.fix(between(Places.TEBET, Places.CAWANG, 0.05), 5.1, speedMps = 3.3f)
        assertTrue(run.state.position > 1.0)
    }

    @Test
    fun `a train still braking through a station's point hasn't left it`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        // In at 5.5 m/s, then on past the point at a walking-plus pace before it ever stands.
        run.fix(between(Places.TEBET, Places.CAWANG, 0.01), 4.0, speedMps = 5.5f)
        run.fix(between(Places.TEBET, Places.CAWANG, 0.03), 4.05, speedMps = 3.5f)
        run.fix(between(Places.TEBET, Places.CAWANG, 0.05), 4.1, speedMps = 2.2f)

        assertEquals(1.0, run.state.position, 0.0)
    }

    @Test
    fun `a train creeping up the platform after standing hasn't left it`() {
        // Manggarai on 2026-10-06: stood, crept on at 2 m/s while still short of the point, stood again.
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(between(Places.TEBET, Places.MANGGARAI, 0.06), 4.0, speedMps = 0.5f)
        run.fix(between(Places.TEBET, Places.MANGGARAI, 0.05), 4.1, speedMps = 2.1f)
        run.fix(between(Places.TEBET, Places.MANGGARAI, 0.04), 4.15, speedMps = 2.4f)

        assertEquals(1.0, run.state.position, 0.0)
    }

    @Test
    fun `the stop to get off at is reached on the way in, however fast`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(between(Places.PASAR_MINGGU_BARU, Places.PASAR_MINGGU, 0.5), 14.0, speedMps = 18f)

        run.fix(Places.PASAR_MINGGU, 15.0, speedMps = 13f)
        assertEquals(alert(AlertKind.ALIGHT, estimated = false), run.alerts().last())
        assertEquals(TripPhase.ARRIVED, run.state.phase)
    }

    @Test
    fun `siap-siap waits for the train to leave the stop before, not to reach it`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.DUREN_KALIBATA, 11.0)

        // In at Pasar Minggu Baru, and held there.
        run.fix(Places.PASAR_MINGGU_BARU, 13.0, speedMps = 0f)
        run.fix(Places.PASAR_MINGGU_BARU, 15.0, speedMps = 0f)
        assertTrue(run.alerts().none { it.kind == AlertKind.PREPARE })

        run.fix(between(Places.PASAR_MINGGU_BARU, Places.PASAR_MINGGU, 0.15), 15.5, speedMps = 10f)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = false)), run.alerts())
    }

    @Test
    fun `a one-stop ride says siap-siap as the train leaves, not at boarding`() {
        val plan = TripPlan(listOf(ride(Places.MANGGARAI, Places.TEBET, line = "KCI:B", departs = 0, arrives = 3)))
        val run = Run(plan)
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(-0.5)))
        assertTrue(run.alerts().none { it.kind == AlertKind.PREPARE })

        run.fix(between(Places.MANGGARAI, Places.TEBET, 0.1), 0.5, speedMps = 9f)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = false)), run.alerts())
    }

    /** A ride of one 2 km hop south on [line], and a fix [metres] short of its end, coming in from the north. */
    private fun arrivingOn(line: String, metres: Double): Run {
        val from = TripStop("A", "A", -6.2000, 106.8300)
        val to = TripStop("B", "B", -6.2000 - 2_000 / 110_574.0, 106.8300)
        val run = Run(TripPlan(listOf(ride(from, to, line = line, departs = 0, arrives = 4))))
        run.tick(0.0)
        run.fix(GeoPoint(to.latitude!! + metres / 110_574.0, to.longitude!!), 3.0)
        return run
    }

    @Test
    fun `a twelve-car KRL is in within 150 m of the station`() {
        assertEquals(TripPhase.ARRIVED, arrivingOn("KCI:C", 140.0).state.phase)
    }

    @Test
    fun `a ten-car KRL on the Rangkasbitung or Tangerang line is in within 130 m`() {
        assertEquals(TripPhase.RIDING, arrivingOn("KCI:R", 140.0).state.phase)
        assertEquals(TripPhase.RIDING, arrivingOn("KCI:T", 140.0).state.phase)
        assertEquals(TripPhase.ARRIVED, arrivingOn("KCI:T", 120.0).state.phase)
    }

    @Test
    fun `a six-car MRT is in within 90 m`() {
        assertEquals(TripPhase.RIDING, arrivingOn("MRTJ:M", 100.0).state.phase)
        assertEquals(TripPhase.ARRIVED, arrivingOn("MRTJ:M", 80.0).state.phase)
    }

    @Test
    fun `a six-car LRT Jabodebek is in within about 80 m`() {
        assertEquals(TripPhase.RIDING, arrivingOn("LRTJBDB:BK", 95.0).state.phase)
        assertEquals(TripPhase.ARRIVED, arrivingOn("LRTJBDB:BK", 70.0).state.phase)
    }

    @Test
    fun `a four-car LRT Jakarta is in within about 57 m`() {
        assertEquals(TripPhase.RIDING, arrivingOn("LRTJ:S", 70.0).state.phase)
        assertEquals(TripPhase.ARRIVED, arrivingOn("LRTJ:S", 50.0).state.phase)
    }

    @Test
    fun `a line whose trains aren't known keeps the 150 m of the longest`() {
        assertEquals(TripPhase.ARRIVED, arrivingOn("APCGK:A", 140.0).state.phase)
    }

    @Test
    fun `a fix between stations places the rider part way along the hop`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(between(Places.TEBET, Places.CAWANG, 0.5), 6.0)

        assertEquals(1.5, run.state.position, 0.1)
    }

    @Test
    fun `fixes far off the route ask once whether the rider is still on it`() {
        val run = Run(bogorLine)
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))
        // Northbound instead: Sudirman, then on towards Tanah Abang.
        val north = Places.SUDIRMAN.here
        run.fix(north, 3.0)
        run.fix(id.shiorilabs.commute.core.geo.GeoPoint(-6.1950, 106.8150), 5.0)
        assertFalse(TripEffect.AskStillOnRoute in run.effects)
        run.fix(id.shiorilabs.commute.core.geo.GeoPoint(-6.1860, 106.8110), 7.0)
        run.fix(id.shiorilabs.commute.core.geo.GeoPoint(-6.1800, 106.8100), 9.0)

        assertEquals(1, run.effects.count { it == TripEffect.AskStillOnRoute })

        run.send(TripEvent.RiderSaid(RiderAction.STILL_ON_ROUTE, at(10)))
        assertEquals(0, run.state.offRouteStrikes)
    }

    @Test
    fun `a fix past the alighting stop asks whether the rider missed it`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.PASAR_MINGGU_BARU, 15.0)
        // About 1.2 km beyond Pasar Minggu, still southbound.
        run.fix(id.shiorilabs.commute.core.geo.GeoPoint(-6.2950, 106.8400), 22.0)

        assertEquals(alert(AlertKind.MISSED, estimated = false), run.alerts().last())
    }

    @Test
    fun `a busway ride with fixes works like rail, and goes unknown when they stop`() {
        val run = Run(busway)
        assertTrue(run.alerts().isEmpty())

        run.fix(Places.HALTE_1, 0.0)
        run.fix(between(Places.HALTE_1, Places.HALTE_2, 0.6), 2.0)
        assertEquals(TripPhase.RIDING, run.state.phase)

        run.tick(6.0)
        assertEquals(PositionSource.UNKNOWN, run.state.source)
        // Nothing invented while it's unknown.
        assertEquals(0.6, run.state.position, 0.05)

        run.fix(Places.HALTE_3, 7.0)
        run.fix(between(Places.HALTE_3, Places.HALTE_4, 0.3), 8.0)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = false)), run.alerts())
        run.fix(Places.HALTE_4, 9.0)
        assertEquals(TripPhase.ARRIVED, run.state.phase)
    }

    @Test
    fun `a bus doubling back to a halte under the next hop isn't put past it`() {
        // The 2026-10-08 ride, minutes from 18.26.
        val run = Run(toCsw, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))
        run.fix(GeoPoint(-6.235754, 106.828080), 2.4, accuracyM = 5f, speedMps = 3.5f)
        // Down Mampang, then south and east beside Tendean, along the hop to CSW the wrong way.
        run.fix(GeoPoint(-6.239674, 106.825963), 9.2, accuracyM = 4f, speedMps = 3.3f)
        run.fix(GeoPoint(-6.239962, 106.827650), 10.2, accuracyM = 13f, speedMps = 1.3f)
        assertTrue(run.state.confirmedPosition < 1.0)
        assertTrue(run.alerts().isEmpty())

        // Queued into Tegal Mampang, then away west on the elevated busway.
        run.fix(GeoPoint(-6.240049, 106.830875), 14.2, accuracyM = 3f, speedMps = 0.6f)
        assertEquals(1.0, run.state.confirmedPosition, 0.0)
        assertTrue(run.alerts().isEmpty())
        run.fix(GeoPoint(-6.240198, 106.828631), 25.4, accuracyM = 4f, speedMps = 9.4f)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = false)), run.alerts())
        run.fix(GeoPoint(-6.239851, 106.799049), 30.8, accuracyM = 7f, speedMps = 5.3f)
        assertEquals(TripPhase.ARRIVED, run.state.phase)
    }

    @Test
    fun `a bus seen past a halte it was never near counts once it carries on`() {
        val run = Run(busway, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))
        run.fix(between(Places.HALTE_1, Places.HALTE_2, 0.5), 1.0, speedMps = 8f)
        // 250 m short of Halte Dua, then past it: held until the next shows it 200 m on.
        run.fix(between(Places.HALTE_2, Places.HALTE_3, 0.2), 2.0, speedMps = 8f)
        assertEquals(0.5, run.state.confirmedPosition, 0.01)
        run.fix(between(Places.HALTE_2, Places.HALTE_3, 0.6), 2.5, speedMps = 8f)
        assertEquals(1.6, run.state.confirmedPosition, 0.01)
    }

    @Test
    fun `a bus seen near a halte and then past it is past it`() {
        val run = Run(busway, startAt = at(0))
        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(0)))
        run.fix(between(Places.HALTE_1, Places.HALTE_2, 0.85), 1.0, speedMps = 8f)
        run.fix(between(Places.HALTE_2, Places.HALTE_3, 0.2), 1.5, speedMps = 8f)
        assertEquals(1.2, run.state.confirmedPosition, 0.01)
    }

    @Test
    fun `a busway ride without location gives its one honest notice and waits for the rider`() {
        val run = Run(busway, hasLocation = false)
        assertEquals(listOf(alert(AlertKind.NO_REMINDERS, estimated = true)), run.alerts())

        run.tick(30.0)
        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
        assertEquals(PositionSource.UNKNOWN, run.state.source)

        run.send(TripEvent.RiderSaid(RiderAction.BOARDED, at(31)))
        run.send(TripEvent.RiderSaid(RiderAction.ALIGHTED, at(45)))
        assertEquals(TripPhase.ARRIVED, run.state.phase)
        assertEquals(1, run.alerts().count { it.kind == AlertKind.NO_REMINDERS })
    }

    @Test
    fun `getting off one ride waits for the next, through the walk between`() {
        val run = Run(withChange)
        run.tick(0.0)
        run.fix(Places.DUKUH_ATAS, 2.0)

        assertEquals(alert(AlertKind.ALIGHT, estimated = false), run.alerts().last())
        assertEquals(2, run.state.legIndex)
        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
        val next = run.state.progress(withChange).next
        assertEquals(NextAction.Change(2, withChange.legs[1] as TripLeg.Transfer), next)

        // The second train leaves at 08.10 and the change was confirmed at 08.02: stale by then.
        run.tick(10.0)
        assertEquals(TripPhase.RIDING, run.state.phase)
        assertEquals(0L, run.state.clockOffsetS)
    }

    @Test
    fun `off at a change with a walk, the rider walks until a fix finds them at the next station`() {
        val run = Run(withChange)
        run.tick(0.0)
        run.fix(Places.DUKUH_ATAS, 2.0)
        assertEquals(at(2.0), run.state.walkingSince)

        // Still by the station they got off at, though it's within reach of the next.
        run.fix(Places.DUKUH_ATAS, 2.5)
        assertEquals(at(2.0), run.state.walkingSince)

        run.fix(Places.SUDIRMAN, 5.0)
        assertNull(run.state.walkingSince)
        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
    }

    @Test
    fun `beside the next line by the station they got off at is still walking`() {
        val run = Run(withChange)
        run.tick(0.0)
        run.fix(Places.DUKUH_ATAS, 2.0)

        // North-east of Dukuh Atas, nearer it than Sudirman, yet just along the line out of Sudirman.
        run.fix(GeoPoint(-6.1995, 106.8250), 2.5)
        assertEquals(at(2.0), run.state.walkingSince)
        assertEquals(0.0, run.state.confirmedPosition, 0.0)
    }

    @Test
    fun `seen moving along the next ride after the walk, the rider is on it`() {
        val run = Run(withChange)
        run.tick(0.0)
        run.fix(Places.DUKUH_ATAS, 2.0)

        run.fix(between(Places.SUDIRMAN, Places.MANGGARAI, 0.4), 11.0)
        run.fix(between(Places.SUDIRMAN, Places.MANGGARAI, 0.6), 11.5)
        assertNull(run.state.walkingSince)
        assertEquals(TripPhase.RIDING, run.state.phase)
    }

    @Test
    fun `standing beside the line part way along the first hop isn't boarding`() {
        val run = Run(bogorLine)
        val office = between(Places.MANGGARAI, Places.TEBET, 0.4)

        run.fix(office, -1.0)
        run.fix(office, -0.5)
        // A rough fix a little further along, a moment later: the fix wandered, not the rider.
        run.fix(between(Places.MANGGARAI, Places.TEBET, 0.45), -0.45, accuracyM = 200f)
        run.fix(office, 0.5)

        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
        assertEquals(0.0, run.state.confirmedPosition, 0.0)
    }

    @Test
    fun `a rider first seen part way along, moving at train speed, is aboard`() {
        val run = Run(bogorLine)

        run.fix(between(Places.MANGGARAI, Places.TEBET, 0.4), -1.0)
        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)

        run.fix(between(Places.MANGGARAI, Places.TEBET, 0.6), -0.5)
        assertEquals(TripPhase.RIDING, run.state.phase)
        assertEquals(0.6, run.state.confirmedPosition, 0.01)
    }

    @Test
    fun `a rider pulling out of the station is aboard once past the platform, however long the hop`() {
        // Setiabudi on 2026-10-06: standing on the platform, then 140 m out at 5 m/s, a sixth of the hop.
        val run = Run(lrtThenKrl)
        run.fix(GeoPoint(-6.209087, 106.830283), 1.0, accuracyM = 4f, speedMps = 0f)
        run.fix(GeoPoint(-6.207960, 106.829877), 1.02, accuracyM = 6f, speedMps = 5.08f)

        assertEquals(TripPhase.RIDING, run.state.phase)
    }

    @Test
    fun `a fix leaping past the platform while the satellites say standing isn't boarding`() {
        val run = Run(lrtThenKrl)
        run.fix(GeoPoint(-6.209087, 106.830283), -1.0, accuracyM = 4f, speedMps = 0f)
        run.fix(GeoPoint(-6.207960, 106.829877), -0.98, accuracyM = 6f, speedMps = 0.3f)

        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
    }

    @Test
    fun `still walking from a station beside the next line, a fix leaping along it isn't boarding`() {
        val run = Run(lrtThenKrl)
        run.tick(0.0)
        run.fix(Places.LRT_DUKUH_ATAS, 2.0, speedMps = 0f)
        // About 270 m along the Commuter Line out of Sudirman, then a rough fix 150 m on: past
        // Sudirman's platform, and still nearer Dukuh Atas.
        run.fix(Places.LRT_DUKUH_ATAS, 2.5)
        run.fix(GeoPoint(-6.205078, 106.826905), 2.58, accuracyM = 30f)

        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
        assertEquals(2, run.state.legIndex)
    }

    @Test
    fun `a train that leaves while the rider is still walking to it isn't boarded by the clock`() {
        val run = Run(withChange)
        run.tick(0.0)
        // Off the MRT late, at 08.09: 300 m to walk for the 08.10.
        run.fix(Places.DUKUH_ATAS, 9.0)
        run.tick(14.0)

        assertEquals(TripPhase.WAITING_TO_BOARD, run.state.phase)
    }

    @Test
    fun `a change at the same station is no walk`() {
        val run = Run(withChange.copy(legs = withChange.legs.filterNot { it is TripLeg.Transfer }))
        run.tick(0.0)
        run.fix(Places.DUKUH_ATAS, 2.0)

        assertNull(run.state.walkingSince)
    }

    @Test
    fun `a trip slept through catches up in one step without a late siap-siap`() {
        val run = Run(withChange, hasLocation = false)
        run.tick(20.0)

        assertEquals(TripPhase.ARRIVED, run.state.phase)
        assertEquals(
            listOf(alert(AlertKind.ALIGHT, 0, estimated = true), alert(AlertKind.ALIGHT, 2, estimated = true)),
            run.alerts(),
        )
    }

    @Test
    fun `a long last hop warns about three minutes out, not at boarding`() {
        val plan = TripPlan(listOf(ride(Places.MANGGARAI, Places.PASAR_MINGGU, departs = 0, arrives = 12)))
        val run = Run(plan, hasLocation = false)

        run.tick(1.0)
        assertTrue(run.alerts().isEmpty())
        run.tick(8.0)
        assertTrue(run.alerts().isEmpty())
        run.tick(9.0)
        assertEquals(listOf(alert(AlertKind.PREPARE, estimated = true)), run.alerts())
    }

    @Test
    fun `stops without coordinates are timed by stop count`() {
        val bare = TripPlan(
            listOf(
                ride(
                    *bogorLine.ride(0).stops.map { it.copy(latitude = null, longitude = null) }.toTypedArray(),
                    departs = 0, arrives = 20,
                ),
            ),
        )
        val run = Run(bare, hasLocation = false)
        run.tick(10.0)

        assertEquals(2.5, run.state.position, 0.01)
    }

    @Test
    fun `a stored trip resumes on the clock and says so until a fix`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.TEBET, 4.0)

        val json = Json { ignoreUnknownKeys = true }
        val plan = json.decodeFromString<TripPlan>(json.encodeToString(TripPlan.serializer(), bogorLine))
        val stored = json.decodeFromString<TripState>(json.encodeToString(TripState.serializer(), run.state))
        assertEquals(bogorLine, plan)
        assertEquals(run.state, stored)

        val resumed = TripEngine.step(plan, stored, TripEvent.Resumed(at(10)))
        assertTrue(resumed.state.resumed)
        assertEquals(PositionSource.ESTIMATED, resumed.state.source)

        val confirmed = TripEngine.step(plan, resumed.state, TripEvent.Fix(Places.DUREN_KALIBATA.here, 20f, at(11)))
        assertFalse(confirmed.state.resumed)
        assertEquals(PositionSource.CONFIRMED, confirmed.state.source)
    }

    @Test
    fun `a forgotten trip ends itself`() {
        val run = Run(busway, startAt = at(0), hasLocation = false)
        assertEquals(at(180), run.step.nextWakeAt)

        run.tick(180.0)
        assertTrue(TripEffect.Finished(FinishReason.TIMED_OUT) in run.effects)
    }

    @Test
    fun `stopping ends the trip and turns location off`() {
        val run = Run(bogorLine)
        run.send(TripEvent.RiderSaid(RiderAction.STOP, at(1)))

        assertTrue(TripEffect.Finished(FinishReason.STOPPED) in run.effects)
        assertNull(run.step.nextWakeAt)
        assertEquals(TripLocationMode.OFF, run.state.locationMode)
    }

    @Test
    fun `stopping once arrived is arriving, not giving up`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.PASAR_MINGGU, 16.0)
        assertEquals(TripPhase.ARRIVED, run.state.phase)

        run.send(TripEvent.RiderSaid(RiderAction.STOP, at(16.5)))
        assertTrue(TripEffect.Finished(FinishReason.ARRIVED) in run.effects)
        assertFalse(TripEffect.Finished(FinishReason.STOPPED) in run.effects)
    }

    @Test
    fun `location is looked for harder on the approach`() {
        val run = Run(bogorLine)
        assertEquals(TripLocationMode.BALANCED, run.state.locationMode)

        run.tick(0.0)
        run.fix(Places.DUREN_KALIBATA, 12.0)
        assertEquals(TripLocationMode.PRECISE, run.state.locationMode)
        assertTrue(TripEffect.SetLocationMode(TripLocationMode.PRECISE) in run.effects)
    }

    @Test
    fun `the clock wakes the trip at the next stop`() {
        val run = Run(bogorLine, hasLocation = false)
        run.tick(0.0)

        val nextStop = RideClock(bogorLine.ride(0)).scheduledAt(1.0)
        assertEquals(nextStop, run.step.nextWakeAt)
    }

    @Test
    fun `a fix too rough to trust is ignored`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.CAWANG, 4.0, accuracyM = 800f)

        assertEquals(0.0, run.state.confirmedPosition, 0.0)
    }

    @Test
    fun `progress counts stops across rides`() {
        val run = Run(withChange, hasLocation = false)
        run.tick(2.0)
        // One hop of two is behind the rider.
        val progress = run.state.progress(withChange)
        assertEquals(listOf(0.5, 0.5), progress.rideFractions)
        assertEquals(0.5, progress.fraction, 0.01)
    }

    @Test
    fun `a stop's expected time carries the lateness a fix found`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.TEBET, 7.0)

        val due = RideClock(bogorLine.ride(0)).scheduledAt(3.0)!!
        assertEquals(due.plusSeconds(run.state.clockOffsetS), run.state.expectedAtStop(bogorLine, 3))
        assertNull(Run(busway).state.expectedAtStop(busway, 2))
    }

    @Test
    fun `a restart a moment after a fix keeps the rider where the fix put them`() {
        val run = Run(bogorLine)
        run.tick(0.0)
        run.fix(Places.MANGGARAI, 5.0)

        // The process dies and comes back a minute later, the train by the timetable well along.
        val resumed = TripEngine.step(bogorLine, run.state, TripEvent.Resumed(at(6)))

        assertEquals(PositionSource.CONFIRMED, resumed.state.source)
        assertEquals(0.0, resumed.state.position, 0.0)
        assertTrue(resumed.effects.none { it is TripEffect.Alert })
    }
}

