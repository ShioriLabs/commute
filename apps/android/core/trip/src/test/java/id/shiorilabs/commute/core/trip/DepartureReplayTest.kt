package id.shiorilabs.commute.core.trip

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.zip.GZIPInputStream

/**
 * [DepartureDetector] over the S23's own sensors, every dwell of two KRL C rides from Cakung: 16 Oct
 * hand-held, with the rider's Jalan marks, and 12 Oct in a pocket. Only the accelerometer and
 * gyroscope are kept, in microseconds from when the engine would arm it (the first fix under
 * 1 m/s), with when the satellites last read the train standing, first read it moving at 2 m/s, and
 * the Jalan mark where there was one.
 */
class DepartureReplayTest {

    private class Dwell(
        val name: String,
        val lastStillUs: Long,
        val firstMovingUs: Long,
        val jalanUs: Long?,
        /** Where the engine arms it once standing has held, when that isn't the samples' zero. */
        val heldUs: Long = 0,
    ) {
        val samples = mutableListOf<Sample>()
    }

    private class Sample(val us: Long, val gyro: Boolean, val v: FloatArray)

    private fun dwells(resource: String): List<Dwell> {
        val stream = requireNotNull(javaClass.getResourceAsStream("/departures/$resource")) { resource }
        val dwells = mutableListOf<Dwell>()
        GZIPInputStream(stream).bufferedReader().forEachLine { line ->
            val parts = line.split(' ')
            if (parts[0] == "dwell") {
                val facts = parts.drop(2).associate { it.substringBefore('=') to it.substringAfter('=') }
                dwells += Dwell(
                    parts[1],
                    facts.getValue("lastStill").toLong(),
                    facts.getValue("firstMoving").toLong(),
                    facts["jalan"]?.toLongOrNull(),
                    facts["held"]?.toLong() ?: 0,
                )
            } else {
                dwells.last().samples += Sample(parts[1].toLong(), parts[0] == "g", FloatArray(3) { parts[2 + it].toFloat() })
            }
        }
        dwells.forEach { dwell -> dwell.samples.sortBy { it.us } }
        return dwells
    }

    /**
     * When the detector said so, and the onset it gave, in the samples' microseconds, armed at [armUs];
     * `null` if it never did.
     */
    private fun replay(dwell: Dwell, armUs: Long = 0): Pair<Long, Long>? {
        val detector = DepartureDetector()
        detector.arm(BASE + armUs * 1000)
        for (sample in dwell.samples) {
            if (sample.us < armUs) continue
            val nanos = BASE + sample.us * 1000
            if (sample.gyro) {
                detector.onGyroscope(nanos, sample.v)
            } else {
                detector.onAccelerometer(nanos, sample.v)?.let { return sample.us to (it - BASE) / 1000 }
            }
        }
        return null
    }

    /**
     * When the train left: the Jalan mark where there is one, else the satellites' last standing fix.
     * Those freeze under a roof (Manggarai's read standing 12 s into the pull on 16 Oct), so the mark wins.
     */
    private fun Dwell.leftUs() = jalanUs ?: lastStillUs

    @Test
    fun `a departure is caught near when the train left and before the satellites see it move`() {
        val all = dwells("krl-2026-10-16.txt.gz") + dwells("krl-2026-10-12.txt.gz")
        val wrong = all.mapNotNull { dwell ->
            val (saidUs, onsetUs) = replay(dwell) ?: return@mapNotNull if (dwell.leftUs() < ANCHORED_US) null else "${dwell.name}: missed"
            val early = if (dwell.jalanUs != null) EARLY_OF_JALAN_US else EARLY_OF_STANDING_US
            when {
                saidUs < dwell.leftUs() - early -> "${dwell.name}: ${(saidUs - dwell.leftUs()) / 1e6} s before it left"
                dwell.jalanUs != null && saidUs > dwell.jalanUs + LATE_OF_JALAN_US -> "${dwell.name}: ${(saidUs - dwell.jalanUs) / 1e6} s after Jalan"
                onsetUs > dwell.firstMovingUs -> "${dwell.name}: onset ${(onsetUs - dwell.firstMovingUs) / 1e6} s after the satellites saw it move"
                else -> null
            }
        }
        assertEquals(15, all.size)
        assertEquals(emptyList<String>(), wrong)
    }

    @Test
    fun `a train that leaves before there are fourteen seconds to anchor on is left to the satellites`() {
        // Klender Baru and Klender on 16 Oct: the first fix to read the train standing came half a
        // minute after the last, as it pulled out. Anchoring on seconds before the arming instead
        // read braking as standing at Matraman and Buaran, 7 to 25 s before the doors shut.
        val all = dwells("krl-2026-10-16.txt.gz") + dwells("krl-2026-10-12.txt.gz")
        val missed = all.filter { replay(it) == null }.map { it.name }

        assertEquals(listOf("oct16-1", "oct16-3"), missed)
    }

    /*
     * 5 Nov evening, Sudirman to Kranji, in a pocket: the samples count from when the satellites
     * (GPS_PROVIDER, every second) first read the train standing; `held` is where the engine arms
     * now, standing fixes 3 s apart.
     */

    @Test
    fun `armed once standing has held, each stop is caught as the train left`() {
        val all = dwells("krl-2026-11-05.txt.gz")
        val wrong = all.mapNotNull { dwell ->
            val (saidUs, onsetUs) = replay(dwell, dwell.heldUs) ?: return@mapNotNull "${dwell.name}: missed"
            when {
                saidUs < dwell.lastStillUs - EARLY_OF_SECOND_FIXES_US -> "${dwell.name}: ${(saidUs - dwell.lastStillUs) / 1e6} s before it left"
                onsetUs > dwell.firstMovingUs -> "${dwell.name}: onset ${(onsetUs - dwell.firstMovingUs) / 1e6} s after the satellites saw it move"
                else -> null
            }
        }
        assertEquals(6, all.size)
        assertEquals(emptyList<String>(), wrong)
    }

    @Test
    fun `armed while the train still brakes, its stopping reads as a pull`() {
        // Why the engine waits for standing to hold: Manggarai on 5 Nov's morning, armed on a fix
        // reading 0.62 m/s under the roof, said the train had left 5½ minutes before it did.
        val early = dwells("krl-2026-11-05.txt.gz").map { dwell ->
            val (saidUs, _) = requireNotNull(replay(dwell, armUs = -15_000_000)) { dwell.name }
            dwell.name to (saidUs < dwell.lastStillUs - 20_000_000)
        }

        assertEquals(early.map { it.first to true }, early)
    }

    private companion object {
        const val BASE = 1_000_000_000_000L

        /** How long after arming a train must stand before its leaving can be read: [DepartureTuning.anchorS]. */
        const val ANCHORED_US = 10_000_000L

        /** A hand taps Jalan late as often as not; Cakung's pull began 10 s before its mark. */
        const val EARLY_OF_JALAN_US = 5_000_000L
        const val LATE_OF_JALAN_US = 7_000_000L

        /**
         * Before the satellites' last "standing" fix: 12 Oct's sixth stop said so 2.3 s before one
         * read 0.15 m/s, 4 s before the train was doing 4.2. Left, but a jolt said it first.
         */
        const val EARLY_OF_STANDING_US = 3_000_000L

        /** Fixes every second read a train under 0.3 m/s for its first seconds out: on 5 Nov each pull was felt up to 8 s before. */
        const val EARLY_OF_SECOND_FIXES_US = 10_000_000L
    }
}
