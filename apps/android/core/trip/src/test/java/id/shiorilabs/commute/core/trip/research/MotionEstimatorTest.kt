package id.shiorilabs.commute.core.trip.research

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

class MotionEstimatorTest {

    /**
     * A KRL hop through a phone tilted in a pocket, its game frame turned 70° from north: 30 s at the
     * platform, away at 0.8 m/s² to 20 m/s, a minute's cruise, braking at 1 m/s² to a stop, 30 s there.
     * The phone reads its accelerometer with gravity in, its gyroscope, and a game rotation vector.
     * Fixes every 5 s outside [blackout], the seconds of the ride with none (a tunnel); from [liesFrom]
     * on, they read [lie] m/s fast. With [fusionTilts], the rotation vector leans into the train's
     * pull as an S23's fusion did, taking it for gravity. [tilt] turns the phone about east, in
     * radians at a time, as a rider shifting it in a pocket.
     */
    private class Ride(
        private val blackout: ClosedFloatingPointRange<Double>? = null,
        private val liesFrom: Double = Double.MAX_VALUE,
        private val lie: Double = 0.0,
        private val fusionTilts: Boolean = false,
        private val tilt: (t: Double) -> Double = { 0.0 },
        private val sensorBias: DoubleArray = doubleArrayOf(0.02, -0.01, 0.0),
    ) {
        val estimator = MotionEstimator()
        private val random = Random(7)
        private val bearing = Math.toRadians(30.0)
        private val gameYaw = Math.toRadians(70.0)
        private val pocket = quaternion(axisX = Math.toRadians(50.0), axisZ = Math.toRadians(20.0))

        var speed = 0.0
            private set

        fun accelAt(t: Double) = when {
            t < 30 -> 0.0
            t < 55 -> 0.8
            t < 115 -> 0.0
            t < 135 -> -1.0
            else -> 0.0
        }

        /** Where the phone is turned at [t]: the pocket's angle, tilted about the game frame's x. */
        private fun phoneAt(t: Double) = multiply(doubleArrayOf(cos(tilt(t) / 2), sin(tilt(t) / 2), 0.0, 0.0), pocket)

        /** Runs to [until] seconds, calling [each] after every motion sample. */
        fun run(until: Double, each: (t: Double) -> Unit = {}) {
            val dt = 0.02
            var t = 0.0
            var nextFix = 0.0
            while (t <= until) {
                val a = accelAt(t)
                speed = max(0.0, speed + a * dt)
                val moving = speed > 0.1
                val noise = if (moving) 0.15 else 0.03
                val east = a * sin(bearing) + random.nextGaussian() * noise
                val north = a * cos(bearing) + random.nextGaussian() * noise
                // ENU into the game frame, then into the phone's, gravity's reaction pointing up.
                val gx = east * cos(gameYaw) - north * sin(gameYaw)
                val gy = east * sin(gameYaw) + north * cos(gameYaw)
                val phone = phoneAt(t)
                val device = rotateInverse(phone, doubleArrayOf(gx, gy, G + random.nextGaussian() * noise))
                val accel = FloatArray(3) { (device[it] + sensorBias[it]).toFloat() }
                // The tilt's rate about the game frame's x, as the phone's own gyroscope sees it.
                val rate = (tilt(t + dt) - tilt(t)) / dt
                val gyro = rotateInverse(phone, doubleArrayOf(rate, 0.0, 0.0)).map { (it + random.nextGaussian() * 0.002).toFloat() }
                val reported = if (fusionTilts && a != 0.0) {
                    // Leaning by atan(a / g) about the horizontal axis square to the pull.
                    val lean = atan2(a, G)
                    val axisX = -gy / max(1e-9, hypot(gx, gy))
                    val axisY = gx / max(1e-9, hypot(gx, gy))
                    multiply(doubleArrayOf(cos(lean / 2), axisX * sin(lean / 2), axisY * sin(lean / 2), 0.0), phone)
                } else {
                    phone
                }
                val nanos = (t * 1e9).toLong()
                estimator.onRotation(reported.map { it.toFloat() }.toFloatArray())
                estimator.onGyroscope(nanos, gyro.toFloatArray())
                estimator.onAccelerometer(nanos, accel)
                if (t >= nextFix - 1e-9) {
                    nextFix += 5.0
                    if (blackout == null || t !in blackout) {
                        val told = if (t >= liesFrom) lie else 0.0
                        val measured = max(0.0, speed + told + random.nextGaussian() * 0.2).toFloat()
                        estimator.onGnss(nanos, measured, 0.3f, if (speed >= 1) 30f else null, 5f)
                    }
                }
                each(t)
                t += dt
            }
        }
    }

    @Test
    fun `before the train has moved, nothing is guessed`() {
        val ride = Ride()
        ride.run(until = 25.0)
        val readout = ride.estimator.readout()
        assertNull(readout.imuSpeedMps)
        assertNull(readout.rawSpeedMps)
        assertTrue(readout.still)
    }

    @Test
    fun `with fixes, the speed follows the train's and the acceleration says which way it's going`() {
        val ride = Ride()
        var worst = 0.0
        var pulling = 0.0
        var braking = 0.0
        ride.run(until = 165.0) { t ->
            val readout = ride.estimator.readout()
            if (t >= 60) worst = max(worst, abs(readout.imuSpeedMps!! - ride.speed))
            if (abs(t - 50) < 0.01) pulling = readout.aLongMps2!!
            if (abs(t - 125) < 0.01) braking = readout.aLongMps2!!
        }
        // Within 3.6 km/h of the train, from fixes a few tenths of a metre a second rough themselves.
        assertTrue("worst off by $worst m/s", worst < 1.0)
        assertTrue("pulling away at $pulling", pulling > 0.5)
        assertTrue("braking at $braking", braking < -0.7)
    }

    @Test
    fun `in a tunnel the sensors carry the speed, braking and all, down to a stop`() {
        // No fixes from 70 s on: mid-cruise, through the braking, and at the platform.
        val ride = Ride(blackout = 69.0..200.0)
        var cruising = 0.0
        var braking = 0.0
        ride.run(until = 165.0) { t ->
            val readout = ride.estimator.readout()
            if (abs(t - 110) < 0.01) cruising = readout.imuSpeedMps!!
            if (abs(t - 125) < 0.01) braking = readout.aLongMps2!!
        }
        assertEquals(20.0, cruising, 2.0)
        assertTrue("braking at $braking", braking < -0.7)
        val stopped = ride.estimator.readout()
        assertTrue("still at ${stopped.imuSpeedMps}", stopped.imuSpeedMps!! < 0.5)
        assertTrue(stopped.still)
    }

    @Test
    fun `the raw speed is the sensors' own, whatever the fixes say`() {
        // From mid-cruise the fixes read 5 m/s fast: the filtered speed goes with them, the raw doesn't.
        val ride = Ride(liesFrom = 70.0, lie = 5.0)
        var raw = 0.0
        var filtered = 0.0
        ride.run(until = 110.0) { t ->
            if (abs(t - 110) < 0.01) {
                raw = ride.estimator.readout().rawSpeedMps!!
                filtered = ride.estimator.readout().imuSpeedMps!!
            }
        }
        assertEquals("raw at $raw, filtered at $filtered", 20.0, raw, 2.0)
        assertTrue("filtered at $filtered", filtered > 23.0)
    }

    @Test
    fun `the raw speed comes back to nothing at the platform`() {
        val ride = Ride(blackout = 69.0..200.0)
        var braking = 0.0
        ride.run(until = 165.0) { t -> if (abs(t - 125) < 0.01) braking = ride.estimator.readout().rawSpeedMps!! }
        assertEquals(10.0, braking, 2.0)
        assertTrue("stopped at ${ride.estimator.readout().rawSpeedMps}", ride.estimator.readout().rawSpeedMps!! < 0.5)
    }

    @Test
    fun `a steady pull still reads when the phone's fusion leans into it`() {
        val ride = Ride(fusionTilts = true)
        var pulling = 0.0
        var braking = 0.0
        ride.run(until = 130.0) { t ->
            if (abs(t - 50) < 0.01) pulling = ride.estimator.readout().aLongMps2!!
            if (abs(t - 125) < 0.01) braking = ride.estimator.readout().aLongMps2!!
        }
        assertTrue("pulling away at $pulling", pulling > 0.6)
        assertTrue("braking at $braking", braking < -0.7)
    }

    @Test
    fun `underground from the start, the first pull says which way is forward`() {
        // Not one fix: an MRT ride from an underground platform.
        val ride = Ride(blackout = -1.0..1000.0)
        var early = 0.0
        var cruising = 0.0
        ride.run(until = 165.0) { t ->
            val readout = ride.estimator.readout()
            if (abs(t - 45) < 0.01) early = readout.rawSpeedMps!!
            if (abs(t - 110) < 0.01) cruising = readout.imuSpeedMps!!
        }
        assertEquals(12.0, early, 2.0)
        assertEquals(20.0, cruising, 3.0)
        assertTrue("stopped at ${ride.estimator.readout().imuSpeedMps}", ride.estimator.readout().imuSpeedMps!! < 0.5)
    }

    @Test
    fun `a phone tilted in the pocket mid-ride isn't read as the train`() {
        // 40° about east over 4 s while cruising, with no fixes to set it right.
        val ride = Ride(blackout = 60.0..1000.0, tilt = { t -> Math.toRadians(40.0) * ((t - 80) / 4).coerceIn(0.0, 1.0) })
        var worst = 0.0
        ride.run(until = 110.0) { t -> if (t > 80) worst = max(worst, abs(ride.estimator.readout().aLongMps2!!)) }
        assertTrue("worst forward acceleration $worst", worst < 0.3)
        assertEquals(20.0, ride.estimator.readout().imuSpeedMps!!, 2.0)
    }

    @Test
    fun `an accelerometer reading off by a fifth of a metre per second squared still settles at the platform`() {
        // An S23 read gravity 9.67 standing: the rotation vector's gravity is off from it from the start.
        val ride = Ride(blackout = 69.0..1000.0, sensorBias = doubleArrayOf(0.25, -0.15, -0.14))
        var standing = false
        var cruising = 0.0
        ride.run(until = 165.0) { t ->
            if (abs(t - 25) < 0.01) standing = ride.estimator.readout().still
            if (abs(t - 110) < 0.01) cruising = ride.estimator.readout().imuSpeedMps!!
        }
        assertTrue("not still at the platform", standing)
        assertEquals(20.0, cruising, 2.0)
        assertTrue("stopped at ${ride.estimator.readout().imuSpeedMps}", ride.estimator.readout().imuSpeedMps!! < 0.5)
    }

    private companion object {

        const val G = 9.81

        /** A rotation about x by [axisX] and then about z by [axisZ], as `[w, x, y, z]`. */
        fun quaternion(axisX: Double, axisZ: Double): DoubleArray {
            val qx = doubleArrayOf(cos(axisX / 2), sin(axisX / 2), 0.0, 0.0)
            val qz = doubleArrayOf(cos(axisZ / 2), 0.0, 0.0, sin(axisZ / 2))
            return multiply(qz, qx)
        }

        fun multiply(a: DoubleArray, b: DoubleArray) = doubleArrayOf(
            a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
            a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
            a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
            a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
        )

        /** [v] in the world frame back into the phone's: the inverse of [q]'s rotation. */
        fun rotateInverse(q: DoubleArray, v: DoubleArray): DoubleArray {
            val conjugate = doubleArrayOf(q[0], -q[1], -q[2], -q[3])
            val r = multiply(multiply(conjugate, doubleArrayOf(0.0, v[0], v[1], v[2])), q)
            return doubleArrayOf(r[1], r[2], r[3])
        }
    }
}
