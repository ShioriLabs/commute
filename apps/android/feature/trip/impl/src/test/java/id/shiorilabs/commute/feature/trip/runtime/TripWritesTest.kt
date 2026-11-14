package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.SpeedSample
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.TripReminder
import id.shiorilabs.commute.feature.trip.minutes
import id.shiorilabs.commute.feature.trip.origin
import id.shiorilabs.commute.feature.trip.plan
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripWritesTest {

    private val riding = ActiveTrip(
        plan,
        TripEngine.start(plan, NOW, hasLocation = true).state.copy(
            phase = TripPhase.RIDING,
            source = PositionSource.CONFIRMED,
            confirmedPosition = 0.2,
            position = 0.2,
            confirmedAt = minutes(2),
        ),
        origin,
    )

    private val writtenAt = minutes(2)

    private fun ActiveTrip.with(change: TripState.() -> TripState) = copy(state = state.change())

    /** [next] five seconds after [riding] was written. */
    private fun writes(next: ActiveTrip) = writesNow(riding, writtenAt, next, writtenAt.plusSeconds(5))

    @Test
    fun `the first trip is written`() {
        assertTrue(writesNow(null, null, riding, writtenAt))
    }

    @Test
    fun `a step that changed nothing isn't written again`() {
        assertFalse(writes(riding))
        assertFalse(writesNow(riding, writtenAt, riding, writtenAt.plusSeconds(60)))
    }

    @Test
    fun `a fix further along the same hop waits`() {
        val further = riding.with {
            copy(
                confirmedPosition = 0.3,
                position = 0.3,
                confirmedAt = minutes(2).plusSeconds(5),
                recentSpeeds = listOf(SpeedSample(0, 12f)),
            )
        }
        assertFalse(writes(further))
    }

    @Test
    fun `and is written once half a minute has passed`() {
        val further = riding.with { copy(confirmedPosition = 0.3, position = 0.3) }
        assertFalse(writesNow(riding, writtenAt, further, writtenAt.plusSeconds(29)))
        assertTrue(writesNow(riding, writtenAt, further, writtenAt.plusSeconds(30)))
    }

    @Test
    fun `a stop reached is written at once, by a fix or by the clock`() {
        assertTrue(writes(riding.with { copy(confirmedPosition = 1.0, position = 1.0) }))
        assertTrue(writes(riding.with { copy(position = 1.1) }))
    }

    @Test
    fun `anything else new is written at once`() {
        assertTrue(writes(riding.with { copy(firedAlerts = setOf("0:PREPARE")) }))
        assertTrue(writes(riding.with { copy(clockOffsetS = 120) }))
        assertTrue(writes(riding.with { copy(phase = TripPhase.WAITING_TO_BOARD) }))
        assertTrue(writes(riding.with { copy(source = PositionSource.ESTIMATED) }))
        assertTrue(writes(riding.with { copy(stoodAt = "0:1") }))
        assertTrue(writes(riding.with { copy(stopTimes = mapOf("0:0" to 1L)) }))
        assertTrue(writes(riding.with { copy(pullingOutFixes = 1) }))
        assertTrue(writes(riding.copy(reminder = TripReminder.WAKE)))
    }

    @Test
    fun `a clock set back doesn't hold a write off`() {
        val further = riding.with { copy(confirmedPosition = 0.3, position = 0.3) }
        assertTrue(writesNow(riding, writtenAt, further, writtenAt.minusSeconds(60)))
    }
}
