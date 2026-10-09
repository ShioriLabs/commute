package id.shiorilabs.commute.core.trip.research

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/** The thresholds [MotionEstimator] runs on, together so a replay can sweep them. */
data class MotionTuning(
    /** A fix no rougher than this, in metres, says something about speed. */
    val gnssAccuracyM: Float = 30f,
    /** Speed variance to assume for a fix that gives no accuracy of its own, (m/s)². */
    val gnssSpeedVariance: Double = 0.25,
    /** Slower than this by the satellites, the train is standing. */
    val standingMps: Float = 0.5f,
    /** Faster than this, the satellites' bearing is the way the train is going. */
    val headingMps: Float = 3f,
    /** Two fixes further apart than this, in seconds, are too far apart to align on. */
    val maxPairS: Double = 40.0,
    /** How much each earlier pair still counts in the alignment, per pair since. */
    val alignDecay: Double = 0.9,
    /** Change of speed the satellites must have seen, in m/s all told, before the alignment is trusted. */
    val alignEvidenceMps: Double = 5.0,
    /** How long the forward acceleration is smoothed over, in seconds. */
    val smoothingS: Double = 1.0,
    /** The window stillness is judged over, in seconds. */
    val stillWindowS: Double = 2.0,
    /** Still: horizontal acceleration this steady, (m/s²)² summed over both axes... */
    val stillVariance: Double = 0.01,
    /** ...and this small on average, m/s², so steady braking isn't standing. */
    val stillMeanMps2: Double = 0.15,
    /** With no satellites to say otherwise, only an estimate this slow is put to zero when still. */
    val stillUnheardMps: Double = 3.0,
    /** A fix this old, in seconds, no longer says whether the train is standing. */
    val gnssFreshS: Double = 10.0,
    /** Acceleration noise the speed is predicted with, m/s² (sensor noise and a misaligned "forward"). */
    val accelNoise: Double = 0.3,
    /** How hard a train may be speeding up or slowing down while forward isn't known yet, m/s². */
    val unalignedAccel: Double = 1.0,
    /** How fast the accelerometer's bias may wander, m/s² per √s. */
    val biasNoise: Double = 0.01,
    /** Speed variance of a zero-velocity update, (m/s)². */
    val stillSpeedVariance: Double = 0.0025,
    /** How long the raw speed's bias is averaged over while standing, in seconds. */
    val rawBiasS: Double = 5.0,
    /** A gap between motion samples longer than this, in seconds, is a gap, not a step. */
    val maxImuGapS: Double = 0.5,
)

/** What [MotionEstimator] makes of the ride so far. Speeds in m/s, acceleration in m/s². */
data class MotionReadout(
    /** The train's speed from the motion sensors, kept honest by the satellites; `null` until aligned. */
    val imuSpeedMps: Double?,
    /**
     * The sensors' speed on their own: the forward acceleration, less what it read standing, summed
     * up, never pulled to a fix's speed, and put to zero only standing; `null` until aligned.
     */
    val rawSpeedMps: Double?,
    /** Forward acceleration, positive pulling away and negative braking; `null` until aligned. */
    val aLongMps2: Double?,
    /** Whether the phone's frame has been lined up with the way the train goes. */
    val aligned: Boolean,
    /** Whether the train looks to be standing. */
    val still: Boolean,
    /** The last fix's own speed, and when it came, on the sensors' clock. */
    val lastGnssSpeedMps: Float?,
    val lastGnssAtNanos: Long?,
)

/**
 * The train's speed and forward acceleration from the phone's motion sensors, in any pocket at any
 * angle, with the satellites where there are any (`docs/android-research-mode.md`, steps 1 to 4).
 * Pure and fed in time order, so a synthetic ride or a recorded one replays the same.
 *
 * Linear acceleration is turned into the game frame by the game rotation vector (gyro and
 * accelerometer only: a train's motors make the compass useless), and its horizontal part lined up
 * with true north by comparing what the sensors say the speed did between two fixes with what the
 * satellites say it did. Forward is the satellites' last bearing at speed, held through a tunnel.
 * The speed is a two-state Kalman filter over speed and the accelerometer's bias: predicted by the
 * forward acceleration, corrected by each fix, and put to zero when the train is plainly standing.
 */
class MotionEstimator(private val tuning: MotionTuning = MotionTuning()) {

    private var lastImuNanos: Long? = null

    // The game-frame change of velocity since the last fix, while the samples have been unbroken.
    private var dvX = 0.0
    private var dvY = 0.0
    private var dvUnbroken = true

    // The last fix the alignment can pair with: when, and its velocity east and north.
    private var pairNanos: Long? = null
    private var pairEast = 0.0
    private var pairNorth = 0.0

    private var sumDot = 0.0
    private var sumCross = 0.0
    private var evidence = 0.0
    private var theta = 0.0

    // Forward, east and north, from the last bearing at speed.
    private var forwardEast: Double? = null
    private var forwardNorth: Double? = null

    // The filter: speed, bias, and their covariance.
    private var speed = 0.0
    private var bias = 0.0
    private var p00 = 100.0
    private var p01 = 0.0
    private var p11 = 0.01

    private var aLong = 0.0
    private var raw: Double? = null
    private var rawBias = 0.0
    private var still = false

    private var lastGnssSpeed: Float? = null
    private var lastGnssNanos: Long? = null

    private val window = ArrayDeque<DoubleArray>()

    val aligned: Boolean get() = evidence >= tuning.alignEvidenceMps

    /**
     * One motion sample: [accel] the linear acceleration in the phone's frame (gravity removed), and
     * [quat] the game rotation vector as `[w, x, y, z]`, both at [nanos] on the monotonic clock.
     */
    fun onImu(nanos: Long, accel: FloatArray, quat: FloatArray) {
        val last = lastImuNanos
        lastImuNanos = nanos
        if (last == null) return
        val dt = (nanos - last) / 1e9
        if (dt <= 0) return
        if (dt > tuning.maxImuGapS) {
            dvUnbroken = false
            window.clear()
            return
        }

        val (x, y) = horizontal(accel, quat)
        dvX += x * dt
        dvY += y * dt
        still = judgeStill(nanos, x, y)

        val fe = forwardEast
        val fn = forwardNorth
        var forward: Double? = null
        if (aligned && fe != null && fn != null) {
            val east = x * cos(theta) - y * sin(theta)
            val north = x * sin(theta) + y * cos(theta)
            forward = east * fe + north * fn
            aLong += (forward - aLong) * (dt / (tuning.smoothingS + dt))
            // From where the filter had it when forward was first known, then the sensors alone: a
            // fix's speed would teach the filter's bias too, so the raw keeps its own, from standing.
            raw = max(0.0, (raw ?: speed) + (forward - rawBias) * dt)
            predict(forward, dt)
        } else {
            // Which way is forward isn't known yet, so neither is what the speed did: the next fix
            // must count for more than a platform's worth of standing still.
            p00 += tuning.unalignedAccel * tuning.unalignedAccel * dt
        }
        if (still && zeroIfStanding(nanos) && forward != null) {
            raw = 0.0
            rawBias += (forward - rawBias) * (dt / (tuning.rawBiasS + dt))
        }
    }

    /** One fix: its speed and bearing where it gave them, how rough it was, and when it came. */
    fun onGnss(nanos: Long, speedMps: Float?, speedAccMps: Float?, bearingDeg: Float?, accuracyM: Float) {
        if (speedMps != null) {
            lastGnssSpeed = speedMps
            lastGnssNanos = nanos
        }
        val good = accuracyM <= tuning.gnssAccuracyM && speedMps != null
        val bearing = bearingDeg?.let { Math.toRadians(it.toDouble()) }

        if (good && bearing != null && speedMps!! > tuning.headingMps) {
            forwardEast = sin(bearing)
            forwardNorth = cos(bearing)
        }

        // The velocity the satellites saw, east and north: none while standing, else along the bearing.
        val velocity = when {
            !good -> null
            speedMps!! < tuning.standingMps -> 0.0 to 0.0
            speedMps >= 1f && bearing != null -> speedMps * sin(bearing) to speedMps * cos(bearing)
            else -> null
        }
        val since = pairNanos
        if (velocity != null && since != null && dvUnbroken && (nanos - since) / 1e9 <= tuning.maxPairS) {
            align(velocity.first - pairEast, velocity.second - pairNorth)
        }
        if (velocity != null) {
            pairNanos = nanos
            pairEast = velocity.first
            pairNorth = velocity.second
        } else {
            pairNanos = null
        }
        dvX = 0.0
        dvY = 0.0
        dvUnbroken = true

        if (good) {
            val variance = speedAccMps?.let { (it * it).toDouble() } ?: tuning.gnssSpeedVariance
            update(speedMps!!.toDouble(), variance)
        }
    }

    fun readout(): MotionReadout {
        val ready = aligned && forwardEast != null
        return MotionReadout(
            imuSpeedMps = speed.takeIf { ready },
            rawSpeedMps = raw.takeIf { ready },
            aLongMps2 = aLong.takeIf { ready },
            aligned = ready,
            still = still,
            lastGnssSpeedMps = lastGnssSpeed,
            lastGnssAtNanos = lastGnssNanos,
        )
    }

    /** The rotation that takes the sensors' change of velocity onto the satellites', least squares. */
    private fun align(gnssEast: Double, gnssNorth: Double) {
        sumDot = sumDot * tuning.alignDecay + (dvX * gnssEast + dvY * gnssNorth)
        sumCross = sumCross * tuning.alignDecay + (dvX * gnssNorth - dvY * gnssEast)
        evidence += hypot(gnssEast, gnssNorth)
        theta = atan2(sumCross, sumDot)
    }

    private fun predict(forward: Double, dt: Double) {
        speed = max(0.0, speed + (forward - bias) * dt)
        // F = [[1, -dt], [0, 1]]; P = F P Fᵀ + Q.
        val n00 = p00 - 2 * dt * p01 + dt * dt * p11 + tuning.accelNoise * tuning.accelNoise * dt
        val n01 = p01 - dt * p11
        val n11 = p11 + tuning.biasNoise * tuning.biasNoise * dt
        p00 = n00
        p01 = n01
        p11 = n11
    }

    private fun update(measured: Double, variance: Double) {
        val s = p00 + variance
        val k0 = p00 / s
        val k1 = p01 / s
        val innovation = measured - speed
        speed = max(0.0, speed + k0 * innovation)
        bias += k1 * innovation
        val n00 = (1 - k0) * p00
        val n01 = (1 - k0) * p01
        val n11 = p11 - k1 * p01
        p00 = n00
        p01 = n01
        p11 = n11
    }

    /** Still for the whole window: horizontal acceleration small and steady. */
    private fun judgeStill(nanos: Long, x: Double, y: Double): Boolean {
        window.addLast(doubleArrayOf(nanos.toDouble(), x, y))
        val horizon = nanos - (tuning.stillWindowS * 1e9).toLong()
        while (window.size > 1 && window.first()[0] < horizon) window.removeFirst()
        if ((nanos - window.first()[0]) / 1e9 < tuning.stillWindowS * 0.9) return false
        var mx = 0.0
        var my = 0.0
        for (s in window) {
            mx += s[1]
            my += s[2]
        }
        mx /= window.size
        my /= window.size
        var variance = 0.0
        for (s in window) variance += (s[1] - mx) * (s[1] - mx) + (s[2] - my) * (s[2] - my)
        variance /= window.size
        return variance < tuning.stillVariance && hypot(mx, my) < tuning.stillMeanMps2
    }

    /**
     * Standing, by the satellites or, with none to ask, when the estimate is near zero already: a
     * smooth cruise in a tunnel is steady too, and must not be put to a stop. Whether it was.
     */
    private fun zeroIfStanding(nanos: Long): Boolean {
        val heard = lastGnssNanos?.takeIf { (nanos - it) / 1e9 <= tuning.gnssFreshS }?.let { lastGnssSpeed }
        val standing = if (heard != null) heard < tuning.standingMps else speed < tuning.stillUnheardMps
        if (standing) update(0.0, tuning.stillSpeedVariance)
        return standing
    }

    private companion object {

        /** [accel] in the phone's frame turned into the game frame by [quat] `[w, x, y, z]`: its east-ish and north-ish parts. */
        fun horizontal(accel: FloatArray, quat: FloatArray): Pair<Double, Double> {
            val w = quat[0].toDouble()
            val x = quat[1].toDouble()
            val y = quat[2].toDouble()
            val z = quat[3].toDouble()
            val norm = sqrt(w * w + x * x + y * y + z * z).takeIf { it > 0 } ?: 1.0
            val qw = w / norm
            val qx = x / norm
            val qy = y / norm
            val qz = z / norm
            val ax = accel[0].toDouble()
            val ay = accel[1].toDouble()
            val az = accel[2].toDouble()
            val east = (1 - 2 * (qy * qy + qz * qz)) * ax + 2 * (qx * qy - qw * qz) * ay + 2 * (qx * qz + qw * qy) * az
            val north = 2 * (qx * qy + qw * qz) * ax + (1 - 2 * (qx * qx + qz * qz)) * ay + 2 * (qy * qz - qw * qx) * az
            return east to north
        }
    }
}
