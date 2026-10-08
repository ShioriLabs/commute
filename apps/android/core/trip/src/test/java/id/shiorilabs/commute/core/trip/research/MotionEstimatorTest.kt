package id.shiorilabs.commute.core.trip.research

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

class MotionEstimatorTest {

    /**
     * A KRL hop through a phone tilted in a pocket, its game frame turned 70° from north: 30 s at the
     * platform, away at 0.8 m/s² to 20 m/s, a minute's cruise, braking at 1 m/s² to a stop, 30 s there.
     * Fixes every 5 s outside [blackout], the seconds of the ride with none (a tunnel).
     */
    private class Ride(private val blackout: ClosedFloatingPointRange<Double>? = null) {
        val estimator = MotionEstimator()
        private val random = Random(7)
        private val bearing = Math.toRadians(30.0)
        private val gameYaw = Math.toRadians(70.0)
        private val phone = quaternion(axisX = Math.toRadians(50.0), axisZ = Math.toRadians(20.0))
        private val sensorBias = doubleArrayOf(0.02, -0.01, 0.0)

        var speed = 0.0
            private set

        fun accelAt(t: Double) = when {
            t < 30 -> 0.0
            t < 55 -> 0.8
            t < 115 -> 0.0
            t < 135 -> -1.0
            else -> 0.0
        }

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
                // ENU into the game frame, then into the phone's.
                val gx = east * cos(gameYaw) - north * sin(gameYaw)
                val gy = east * sin(gameYaw) + north * cos(gameYaw)
                val device = rotateInverse(phone, doubleArrayOf(gx, gy, random.nextGaussian() * noise))
                val accel = FloatArray(3) { (device[it] + sensorBias[it]).toFloat() }
                val nanos = (t * 1e9).toLong()
                estimator.onImu(nanos, accel, phone.map { it.toFloat() }.toFloatArray())
                if (t >= nextFix - 1e-9) {
                    nextFix += 5.0
                    if (blackout == null || t !in blackout) {
                        val measured = max(0.0, speed + random.nextGaussian() * 0.2).toFloat()
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

    private companion object {

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
