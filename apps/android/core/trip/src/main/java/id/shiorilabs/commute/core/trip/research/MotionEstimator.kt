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
    /** How fast gravity settles on what the accelerometer reads while the phone lies still on a standing train, in seconds. */
    val gravitySettleS: Double = 1.0,
    /**
     * How slowly gravity drifts toward what the accelerometer reads at any time, in seconds: long
     * beside a pull, short beside the gyroscope's drift. Off until a ride with the phone in a pocket
     * says what it should be; a hand-held ride on 2026-10-09 favoured none.
     */
    val gravityFollowS: Double = Double.POSITIVE_INFINITY,
    /** A pull this hard, m/s², smoothed, soon after standing, is the train setting off... */
    val pullMps2: Double = 0.2,
    /** ...when it lasts this long, in seconds... */
    val pullS: Double = 3.0,
    /** ...and starts within this long of standing, in seconds... */
    val pullAfterStandingS: Double = 20.0,
    /** ...with the phone turning no faster than this, rad/s, so a hand moving it isn't one (held, it turns at 0.25). */
    val pullQuietGyro: Double = 0.5,
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
 * Gravity is its own: turned with the phone by the gyroscope, and set to what the accelerometer
 * reads only while the train stands: on average between two fixes that both say so, in a hand that's
 * never still, or as it reads lying still. The phone's fusion (linear acceleration, the game rotation
 * vector's tilt) settles toward a train's steady pull and takes it for gravity: an S23 read
 * 0.0 ± 0.1 m/s² of a 0.5 m/s² pull out of a station on 2026-10-09, leaning 3° into it.
 *
 * The acceleration less gravity is turned into the game frame by the game rotation vector (gyro and
 * accelerometer only: a train's motors make the compass useless), and its horizontal part lined up
 * with true north by comparing what the sensors say the speed did between two fixes with what the
 * satellites say it did. Forward is the satellites' last bearing at speed, held through a tunnel;
 * with none yet (an underground platform), the way the train first pulls after standing.
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
    // The accelerometer's own error is gravity's now, so little is left for the bias: given as much
    // room as before, it learned a fix's noise and ran 4 m/s fast after a minute and a half blind.
    private var p11 = 0.0025

    private var aLong = 0.0
    private var raw: Double? = null
    private var rawBias = 0.0
    private var still = false

    private var lastGnssSpeed: Float? = null
    private var lastGnssNanos: Long? = null

    private val window = ArrayDeque<DoubleArray>()

    // The latest game rotation vector, [w, x, y, z].
    private val quat = FloatArray(4)
    private var haveQuat = false

    // Gravity in the phone's frame, m/s², as the accelerometer reads it standing; and the gyroscope's
    // last sample, for the turn since.
    private var gravity: DoubleArray? = null
    private var lastGyroNanos: Long? = null
    private var gyroRate = 0.0
    private var settling = false

    // The acceleration less gravity since the last fix, summed in the game frame where a hand's
    // turning averages out, and how long over: what gravity is off by, if the train stood throughout.
    private var residualX = 0.0
    private var residualY = 0.0
    private var residualZ = 0.0
    private var residualS = 0.0
    private var lastFixStood = false

    // The way the train pulled off from standing, in the game frame: forward with no satellites.
    private var stoodNanos: Long? = null
    private var pullX = 0.0
    private var pullY = 0.0
    private var pullSince: Long? = null
    private var pullSumX = 0.0
    private var pullSumY = 0.0
    private var axisX: Double? = null
    private var axisY: Double? = null

    val aligned: Boolean get() = evidence >= tuning.alignEvidenceMps

    /** The game rotation vector as `[w, x, y, z]`: which way the phone's frame is turned. */
    fun onRotation(quat: FloatArray) {
        quat.copyInto(this.quat)
        haveQuat = true
    }

    /** One gyroscope sample, rad/s in the phone's frame, at [nanos] on the monotonic clock: gravity turns with it. */
    fun onGyroscope(nanos: Long, rate: FloatArray) {
        val last = lastGyroNanos
        lastGyroNanos = nanos
        val g = gravity ?: return
        if (last == null) return
        val dt = (nanos - last) / 1e9
        if (dt <= 0 || dt > tuning.maxImuGapS) return
        val wx = rate[0].toDouble()
        val wy = rate[1].toDouble()
        val wz = rate[2].toDouble()
        // A vector fixed in the world, seen from a phone turning at ω, turns at -ω × it. A step along
        // the tangent lengthens it a little each time, so it's put back to its length: in a hand
        // turning at 1 rad/s, gravity had doubled within minutes.
        val length = sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2])
        val cx = wy * g[2] - wz * g[1]
        val cy = wz * g[0] - wx * g[2]
        val cz = wx * g[1] - wy * g[0]
        g[0] -= cx * dt
        g[1] -= cy * dt
        g[2] -= cz * dt
        val stretched = sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2])
        if (stretched > 0) for (i in 0..2) g[i] *= length / stretched
        gyroRate += (sqrt(wx * wx + wy * wy + wz * wz) - gyroRate) * (dt / (tuning.smoothingS + dt))
    }

    /**
     * One accelerometer sample, gravity in, m/s² in the phone's frame, at [nanos] on the monotonic
     * clock. Until the train is first seen standing, gravity is where the rotation vector puts it.
     */
    fun onAccelerometer(nanos: Long, accel: FloatArray) {
        if (!haveQuat) return
        val a = DoubleArray(3) { accel[it].toDouble() }
        val g = gravity ?: fusedGravity(quat).also { gravity = it }
        val last = lastImuNanos
        val linear = DoubleArray(3) { a[it] - g[it] }
        step(nanos, FloatArray(3) { linear[it].toFloat() })
        val dt = last?.let { (nanos - it) / 1e9 } ?: return
        if (dt <= 0 || dt > tuning.maxImuGapS) return
        val game = toGame(linear, quat)
        residualX += game[0] * dt
        residualY += game[1] * dt
        residualZ += game[2] * dt
        residualS += dt
        val follow = if (settling) tuning.gravitySettleS else tuning.gravityFollowS
        for (i in 0..2) g[i] += (a[i] - g[i]) * (dt / (follow + dt))
    }

    /** One motion sample: [accel] the acceleration less gravity in the phone's frame, at [nanos]. */
    private fun step(nanos: Long, accel: FloatArray) {
        val last = lastImuNanos
        lastImuNanos = nanos
        if (last == null) return
        val dt = (nanos - last) / 1e9
        if (dt <= 0) return
        if (dt > tuning.maxImuGapS) {
            dvUnbroken = false
            residualS = 0.0
            lastFixStood = false
            window.clear()
            return
        }

        val (x, y) = horizontal(accel, quat)
        dvX += x * dt
        dvY += y * dt
        still = judgeStill(nanos, x, y)
        settling = still && stands(nanos)
        learnPull(nanos, x, y, dt)

        val fe = forwardEast
        val fn = forwardNorth
        val ax = axisX
        val ay = axisY
        var forward: Double? = null
        if (aligned && fe != null && fn != null) {
            val east = x * cos(theta) - y * sin(theta)
            val north = x * sin(theta) + y * cos(theta)
            forward = east * fe + north * fn
        } else if (ax != null && ay != null) {
            forward = x * ax + y * ay
        }
        if (forward != null) {
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
        val standing = still && zeroIfStanding(nanos)
        if (standing || settling) stoodNanos = nanos
        if (standing && forward != null) {
            raw = 0.0
            rawBias += (forward - rawBias) * (dt / (tuning.rawBiasS + dt))
        }
    }

    /**
     * Out of a station a train only ever pulls forward: a steady pull soon after standing, the phone
     * held still, is the way the train goes, learnt again each time it sets off. What it gained
     * while the pull was being made sure of is speed already.
     */
    private fun learnPull(nanos: Long, x: Double, y: Double, dt: Double) {
        pullX += (x - pullX) * (dt / (tuning.smoothingS + dt))
        pullY += (y - pullY) * (dt / (tuning.smoothingS + dt))
        val fresh = stoodNanos?.let { (nanos - it) / 1e9 <= tuning.pullAfterStandingS } == true
        if (!fresh || still || gyroRate > tuning.pullQuietGyro || hypot(pullX, pullY) < tuning.pullMps2) {
            pullSince = null
            return
        }
        val since = pullSince ?: nanos.also {
            pullSince = it
            pullSumX = 0.0
            pullSumY = 0.0
        }
        pullSumX += x * dt
        pullSumY += y * dt
        if ((nanos - since) / 1e9 < tuning.pullS) return
        val gained = hypot(pullSumX, pullSumY)
        // Learnt before, the old axis has been carrying the speed meanwhile.
        val first = axisX == null
        axisX = pullSumX / gained
        axisY = pullSumY / gained
        stoodNanos = null
        pullSince = null
        if (first && !(aligned && forwardEast != null)) {
            raw = (raw ?: 0.0) + gained
            speed += gained
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
        // A fix with no speed, or too rough to trust one, says nothing either way: the sum runs on.
        if (good) settleBetweenFixes(nanos, stood = speedMps!! < tuning.standingMps)

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

    /**
     * Two fixes in a row standing: the train stood between them, so what the accelerometer read over
     * the gap, less gravity, is how far off gravity is. Each fix starts the sum again.
     */
    private fun settleBetweenFixes(nanos: Long, stood: Boolean) {
        val g = gravity
        if (stood && lastFixStood && g != null && residualS >= 1.0 && residualS <= tuning.maxPairS) {
            val off = toPhone(doubleArrayOf(residualX / residualS, residualY / residualS, residualZ / residualS), quat)
            for (i in 0..2) g[i] += off[i]
        }
        if (stood) stoodNanos = lastImuNanos ?: nanos
        lastFixStood = stood
        residualX = 0.0
        residualY = 0.0
        residualZ = 0.0
        residualS = 0.0
    }

    fun readout(): MotionReadout {
        val ready = (aligned && forwardEast != null) || axisX != null
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
        val standing = stands(nanos)
        if (standing) update(0.0, tuning.stillSpeedVariance)
        return standing
    }

    /** Standing by a fresh fix, or with none to ask, slow enough by the estimate to be. */
    private fun stands(nanos: Long): Boolean {
        val heard = lastGnssNanos?.takeIf { (nanos - it) / 1e9 <= tuning.gnssFreshS }?.let { lastGnssSpeed }
        return if (heard != null) heard < tuning.standingMps else speed < tuning.stillUnheardMps
    }

    private companion object {

        const val G = 9.80665

        /**
         * Gravity where the rotation vector [quat] `[w, x, y, z]` puts it in the phone's frame. As strong
         * as standard gravity: one sample's own strength is a jolt as often as not (10.6 against 9.75).
         */
        fun fusedGravity(quat: FloatArray): DoubleArray = toPhone(doubleArrayOf(0.0, 0.0, G), quat)

        /** [v] in the phone's frame turned into the game frame by [quat] `[w, x, y, z]`. */
        fun toGame(v: DoubleArray, quat: FloatArray): DoubleArray = rotate(v, quat, inverse = false)

        /** [v] in the game frame turned into the phone's by [quat] `[w, x, y, z]`. */
        fun toPhone(v: DoubleArray, quat: FloatArray): DoubleArray = rotate(v, quat, inverse = true)

        private fun rotate(v: DoubleArray, quat: FloatArray, inverse: Boolean): DoubleArray {
            val w = quat[0].toDouble()
            val x = quat[1].toDouble()
            val y = quat[2].toDouble()
            val z = quat[3].toDouble()
            val n = sqrt(w * w + x * x + y * y + z * z).takeIf { it > 0 } ?: 1.0
            val qw = w / n
            val qx = x / n
            val qy = y / n
            val qz = z / n
            val r = arrayOf(
                doubleArrayOf(1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy)),
                doubleArrayOf(2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx)),
                doubleArrayOf(2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)),
            )
            return DoubleArray(3) { i -> (0..2).sumOf { j -> (if (inverse) r[j][i] else r[i][j]) * v[j] } }
        }

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
