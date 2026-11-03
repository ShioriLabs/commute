package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.time.minuteOfDay
import id.shiorilabs.commute.core.ui.time.nextTimetableTick
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDateTime

/**
 * The timetable clock ticks only at [nextTimetableTick]'s seconds: between two ticks, everything a
 * board reads off the clock must read as it did at the first. Should the board's rounding change,
 * this says the ticks must too.
 */
class TimetableTickBoardTest {

    /** Every minute around the hours tested, the night's past midnight included, as departures are. */
    private val minutes = (0 until 4 * 60) + (6 * 60..10 * 60) + (20 * 60 until 24 * 60)
    private val departures = minutes.map { Departure(null, it) }

    /** Everything a board reads off the clock, at [now]. */
    private fun board(now: LocalDateTime) = listOf(
        minuteOfDay(now),
        now.hour,
        minutes.map { departureLabel(now, it) },
        minutes.map { isImminentDeparture(now, it) },
        nextDepartures(departures, now),
    )

    private fun readsTheSameBetweenTicks(from: LocalDateTime, until: LocalDateTime) {
        var tick = nextTimetableTick(from)
        while (tick.isBefore(until)) {
            val next = nextTimetableTick(tick)
            val atTick = board(tick)
            var t = tick
            while (t.isBefore(next)) {
                assertEquals("read at $t, ticked at $tick", atTick, board(t))
                // Each second, and its last instant.
                assertEquals("read at ${t.plusNanos(999_999_999)}, ticked at $tick", atTick, board(t.plusNanos(999_999_999)))
                t = t.plusSeconds(1)
            }
            tick = next
        }
    }

    @Test
    fun `an hour's board changes only on a tick`() {
        readsTheSameBetweenTicks(LocalDateTime.of(2026, 11, 3, 7, 59, 59), LocalDateTime.of(2026, 11, 3, 9, 0, 1))
    }

    @Test
    fun `so does one where late trains sort after the evening`() {
        readsTheSameBetweenTicks(LocalDateTime.of(2026, 11, 3, 20, 59, 0), LocalDateTime.of(2026, 11, 3, 21, 2, 0))
    }
}
