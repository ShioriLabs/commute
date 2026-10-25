package id.shiorilabs.commute.core.trip

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Random
import kotlin.math.cos
import kotlin.math.sin

class DepartureDetectorTest {

    /**
     * A phone at a station, tilted in a pocket at [tiltX] about its own x, read at 50 Hz: [accelAt]
     * the train's horizontal acceleration along the phone's own y as it lies, m/s², [turnAt] how fast
     * the phone turns about its z, rad/s. Noise as a standing train's.
     */
    private class Platform(
        private val accelAt: (t: Double) -> Double = { 0.0 },
        private val turnAt: (t: Double) -> Double = { 0.0 },
        private val tiltX: Double = Math.toRadians(40.0),
        private val noise: Double = 0.05,
    ) {
        val detector = DepartureDetector()
        private val random = Random(11)
        private var yaw = 0.0

        /** Feeds [from] to [until] seconds, skipping [gap]; the first onset the detector gives, in seconds. */
        fun run(from: Double, until: Double, gap: ClosedFloatingPointRange<Double>? = null): Double? {
            val dt = 0.02
            var t = from
            var onset: Double? = null
            while (t <= until) {
                if (gap == null || t !in gap) {
                    val rate = turnAt(t)
                    yaw += rate * dt
                    // The pull in the world's horizontal, turned back by the phone's yaw, then its tilt;
                    // gravity's reaction up.
                    val a = accelAt(t)
                    val worldX = -a * sin(yaw)
                    val worldY = a * cos(yaw)
                    val worldZ = G
                    val px = worldX
                    val py = worldY * cos(tiltX) + worldZ * sin(tiltX)
                    val pz = -worldY * sin(tiltX) + worldZ * cos(tiltX)
                    val nanos = (t * 1e9).toLong()
                    detector.onGyroscope(nanos, floatArrayOf(0f, (rate * sin(tiltX)).toFloat(), (rate * cos(tiltX)).toFloat()).noisy(0.002))
                    val hit = detector.onAccelerometer(nanos, floatArrayOf(px.toFloat(), py.toFloat(), pz.toFloat()).noisy(noise))
                    if (hit != null && onset == null) onset = hit / 1e9
                }
                t += dt
            }
            return onset
        }

        private fun FloatArray.noisy(sd: Double) = FloatArray(size) { (this[it] + random.nextGaussian() * sd).toFloat() }
    }

    @Test
    fun `a train standing at the platform never leaves`() {
        val platform = Platform()
        platform.detector.arm(0)

        assertNull(platform.run(0.0, 120.0))
    }

    @Test
    fun `a train pulling out after standing leaves when its pull began`() {
        val platform = Platform(accelAt = { if (it >= 30.0) 0.5 else 0.0 })
        platform.detector.arm(0)

        val onset = platform.run(0.0, 60.0)

        assertNotNull(onset)
        assertEquals(30.0, onset!!, 1.0)
    }

    @Test
    fun `a pull the detector isn't armed for is not a departure`() {
        val platform = Platform(accelAt = { if (it >= 30.0) 0.5 else 0.0 })

        assertNull(platform.run(0.0, 60.0))
    }

    @Test
    fun `it says so once for each arming`() {
        val platform = Platform(accelAt = { if (it in 30.0..50.0) 0.5 else 0.0 })
        platform.detector.arm(0)
        platform.run(0.0, 40.0)

        assertNull(platform.run(40.02, 90.0))
    }

    @Test
    fun `a phone being turned in a hand is not the train`() {
        val platform = Platform(
            accelAt = { if (it >= 30.0) 0.5 else 0.0 },
            turnAt = { if (it >= 30.0) 2.0 else 0.0 },
        )
        platform.detector.arm(0)

        assertNull(platform.run(0.0, 40.0))
    }

    @Test
    fun `armed in the last second of braking, the stop is not a departure`() {
        val platform = Platform(accelAt = { if (it < 1.0) -1.0 else 0.0 })
        platform.detector.arm(0)

        assertNull(platform.run(0.0, 60.0))
    }

    @Test
    fun `a pull just after a gap in the samples isn't read against the standing before it`() {
        // Read against the bins before the gap it would be a departure at 33 s; after the gap the
        // only gravity to be had is taken during the pull, which then reads as none.
        val platform = Platform(accelAt = { if (it >= 33.0) 0.5 else 0.0 })
        platform.detector.arm(0)

        assertNull(platform.run(0.0, 60.0, gap = 30.0..30.7))
    }

    @Test
    fun `a gap long past is forgotten once there are fourteen seconds of samples again`() {
        val platform = Platform(accelAt = { if (it >= 50.0) 0.5 else 0.0 })
        platform.detector.arm(0)

        val onset = platform.run(0.0, 70.0, gap = 30.0..30.7)

        assertNotNull(onset)
        assertEquals(50.0, onset!!, 1.0)
    }

    private companion object {
        const val G = 9.80665
    }
}
