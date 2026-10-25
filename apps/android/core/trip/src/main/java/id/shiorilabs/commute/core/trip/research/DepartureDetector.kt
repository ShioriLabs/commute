package id.shiorilabs.commute.core.trip.research

import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** The thresholds [DepartureDetector] runs on, together so a replay can sweep them. */
data class DepartureTuning(
    /** How long gravity is averaged over, in seconds... */
    val anchorS: Int = 10,
    /** ...ending this long ago: the seconds a pull must hold, each its own second. */
    val testS: Int = 4,
    /** How hard each of those seconds must pull, m/s², level with the ground. */
    val pullMps2: Double = 0.25,
    /** How fast the phone may turn on average in each, rad/s: faster is a hand, not the train. */
    val quietGyro: Double = 1.5,
    /** How nearly each second's pull must point the way the first did (a cosine). */
    val sameWay: Double = 0.8,
    /** A gap between samples longer than this, in seconds, starts the seconds again. */
    val maxGapS: Double = 0.5,
)

/**
 * A train at a station setting off, by the motion sensors alone, seconds before the satellites see
 * it move: their fixes come every half minute and freeze under a station's roof (Manggarai read
 * 0.2 m/s on 16 Oct while the train pulled out). Pure and fed in time order, so a recorded ride
 * replays the same.
 *
 * Every accelerometer sample is turned by the gyroscope alone into the frame the phone had when
 * [arm]ed (the fusion's own gravity leans into a train's pull and takes it for gravity), and kept
 * as one-second means. Gravity is the mean of the [DepartureTuning.anchorS] seconds before the last
 * [DepartureTuning.testS]; those must each pull level with the ground, the same way, with the phone
 * quiet. A sliding anchor, not one from when the train stopped: a hand shifting the phone on a long
 * dwell moves it, and a fixed one read departures 228 s and 134 s early on 16 Oct.
 *
 * It reads any pull, braking and speeding up between stations too, so it's armed only once the train
 * stands: armed while it still brakes, the braking is in the anchor and standing reads as a pull.
 * It says so once per arming. Tuned on 15 KRL departures of an S23, hand-held and in a pocket.
 */
class DepartureDetector(private val tuning: DepartureTuning = DepartureTuning()) {

    private var armed = false

    // Phone to reference frame, row-major.
    private val r = DoubleArray(9)
    private var lastGyroNanos: Long? = null
    private var lastAccelNanos: Long? = null

    // The second being filled: when it began, and its sums.
    private var binStart: Long? = null
    private val sum = DoubleArray(3)
    private var count = 0
    private var gyroSum = 0.0
    private var gyroCount = 0

    /** Seconds done, oldest first: mean acceleration in the reference frame, mean turn, when each began. */
    private val bins = ArrayDeque<Bin>()

    private class Bin(val start: Long, val accel: DoubleArray, val gyro: Double?)

    val isArmed: Boolean get() = armed

    /** From [nanos] on, a pull out of standing is a departure. */
    fun arm(nanos: Long) {
        armed = true
        identity()
        lastGyroNanos = null
        lastAccelNanos = null
        startBin(nanos)
        bins.clear()
    }

    fun disarm() {
        armed = false
        bins.clear()
        binStart = null
    }

    /** One gyroscope sample, rad/s in the phone's frame, at [nanos] on the monotonic clock. */
    fun onGyroscope(nanos: Long, rate: FloatArray) {
        if (!armed) return
        val last = lastGyroNanos
        lastGyroNanos = nanos
        val wx = rate[0].toDouble()
        val wy = rate[1].toDouble()
        val wz = rate[2].toDouble()
        val w = sqrt(wx * wx + wy * wy + wz * wz)
        gyroSum += w
        gyroCount++
        if (last == null) return
        val dt = (nanos - last) / 1e9
        if (dt <= 0) return
        if (dt > tuning.maxGapS) {
            restart(nanos)
            return
        }
        turn(wx, wy, wz, w, dt)
    }

    /**
     * One accelerometer sample, gravity in, m/s² in the phone's frame, at [nanos] on the monotonic
     * clock. When the pull has held: the moment it began, on the same clock; else `null`.
     */
    fun onAccelerometer(nanos: Long, accel: FloatArray): Long? {
        if (!armed) return null
        val last = lastAccelNanos
        lastAccelNanos = nanos
        if (last != null && (nanos - last) / 1e9 > tuning.maxGapS) restart(nanos)
        val start = binStart ?: return null
        if (nanos - start >= SECOND) {
            closeBin(start)
            startBin(start + SECOND * ((nanos - start) / SECOND))
            val onset = pulling()
            if (onset != null) {
                disarm()
                return onset
            }
        }
        val ax = accel[0].toDouble()
        val ay = accel[1].toDouble()
        val az = accel[2].toDouble()
        sum[0] += r[0] * ax + r[1] * ay + r[2] * az
        sum[1] += r[3] * ax + r[4] * ay + r[5] * az
        sum[2] += r[6] * ax + r[7] * ay + r[8] * az
        count++
        return null
    }

    /** Whether the last seconds pull out of the ones before; when the pull began if so. */
    private fun pulling(): Long? {
        val need = tuning.anchorS + tuning.testS
        if (bins.size < need) return null
        val window = bins.toList().takeLast(need)
        val gravity = DoubleArray(3)
        for (bin in window.take(tuning.anchorS)) for (i in 0..2) gravity[i] += bin.accel[i] / tuning.anchorS
        val g = norm(gravity).takeIf { it > 0 } ?: return null
        val up = DoubleArray(3) { gravity[it] / g }
        var first: DoubleArray? = null
        for (bin in window.drop(tuning.anchorS)) {
            val turning = bin.gyro ?: return null
            if (turning > tuning.quietGyro) return null
            val off = DoubleArray(3) { bin.accel[it] - gravity[it] }
            val vertical = off[0] * up[0] + off[1] * up[1] + off[2] * up[2]
            val level = DoubleArray(3) { off[it] - vertical * up[it] }
            val pull = norm(level)
            if (pull < tuning.pullMps2) return null
            val way = DoubleArray(3) { level[it] / pull }
            val from = first ?: way.also { first = it }
            if (way[0] * from[0] + way[1] * from[1] + way[2] * from[2] <= tuning.sameWay) return null
        }
        return window[tuning.anchorS].start
    }

    private fun closeBin(start: Long) {
        if (count > 0) {
            bins.addLast(Bin(start, DoubleArray(3) { sum[it] / count }, if (gyroCount > 0) gyroSum / gyroCount else null))
            while (bins.size > tuning.anchorS + tuning.testS) bins.removeFirst()
        } else {
            // A second with no samples in it is a gap.
            bins.clear()
        }
    }

    private fun startBin(nanos: Long) {
        binStart = nanos
        sum.fill(0.0)
        count = 0
        gyroSum = 0.0
        gyroCount = 0
    }

    /** After a gap: the turn since can't be known, so neither can the seconds before it be held against what comes. */
    private fun restart(nanos: Long) {
        identity()
        bins.clear()
        startBin(nanos)
    }

    private fun identity() {
        r.fill(0.0)
        r[0] = 1.0
        r[4] = 1.0
        r[8] = 1.0
    }

    /** r = r · exp([ω]× dt): the phone turned by [w] rad/s about (wx, wy, wz) for [dt] s, its own axes. */
    private fun turn(wx: Double, wy: Double, wz: Double, w: Double, dt: Double) {
        val angle = w * dt
        if (angle < 1e-12) return
        val kx = wx / w
        val ky = wy / w
        val kz = wz / w
        val s = sin(angle)
        val c = 1 - cos(angle)
        // Rodrigues: I + sin θ K + (1 − cos θ) K².
        val step = doubleArrayOf(
            1 - c * (ky * ky + kz * kz), -s * kz + c * kx * ky, s * ky + c * kx * kz,
            s * kz + c * kx * ky, 1 - c * (kx * kx + kz * kz), -s * kx + c * ky * kz,
            -s * ky + c * kx * kz, s * kx + c * ky * kz, 1 - c * (kx * kx + ky * ky),
        )
        val out = DoubleArray(9)
        for (i in 0..2) for (j in 0..2) out[i * 3 + j] = (0..2).sumOf { k -> r[i * 3 + k] * step[k * 3 + j] }
        out.copyInto(r)
    }

    private fun norm(v: DoubleArray) = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])

    private companion object {
        const val SECOND = 1_000_000_000L
    }
}
