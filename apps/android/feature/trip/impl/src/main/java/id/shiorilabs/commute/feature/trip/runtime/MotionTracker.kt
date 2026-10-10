package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.research.MotionEstimator
import id.shiorilabs.commute.core.trip.research.MotionReadout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToInt

/** What the motion sensors make of the ride, as the trip page shows it; [nowNanos] to age the last fix by. */
data class MotionLive(val readout: MotionReadout?, val unavailable: Boolean, val nowNanos: Long)

/**
 * "Kecepatan IMU" (Experimental): the motion sensors read at 50 Hz while a train is ridden, through
 * a [MotionEstimator] the trip's fixes keep honest, so the trip page can set its speed beside the
 * satellites'. Nothing the trip decides reads it. Each fix, and every few seconds without one (a
 * tunnel), it writes an `imu` line to the trip log, to set against the rider's marks afterwards;
 * every sample, fix and estimate also goes to the leg's [SensorRecorder] file.
 *
 * The sensors aren't wake-up sensors: with the CPU asleep their samples are lost, so a partial wake
 * lock is held while it runs. That's the battery the switch warns of.
 */
@Singleton
class MotionTracker @Inject constructor(
    @ApplicationContext private val context: Context,
    private val log: TripLog,
    private val recorder: SensorRecorder,
    @ApplicationScope private val scope: CoroutineScope,
) {

    private val _live = MutableStateFlow<MotionLive?>(null)

    /** `null` while it isn't running. */
    val live: StateFlow<MotionLive?> = _live.asStateFlow()

    private val lock = Any()
    private var estimator: MotionEstimator? = null
    private var thread: HandlerThread? = null
    private var listener: SensorEventListener? = null
    private var ticker: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val quat = FloatArray(4)
    private var haveQuat = false
    private var lastFixNanos = 0L
    private var lastLineNanos = 0L
    private var toldUnavailable = false

    /** Starts reading for [ride], recording it, unless it's running already. */
    fun start(ride: TripLeg.Ride) {
        if (estimator != null || _live.value?.unavailable == true) return
        val sensors = context.getSystemService(SensorManager::class.java)
        val accel = sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyro = sensors?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        val rotation = sensors?.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        if (sensors == null || accel == null || gyro == null || rotation == null) {
            if (!toldUnavailable) {
                toldUnavailable = true
                log.event("imu", mapOf("unavailable" to true, "accel" to (accel != null), "gyro" to (gyro != null), "rotation" to (rotation != null)))
            }
            _live.value = MotionLive(null, unavailable = true, nowNanos = SystemClock.elapsedRealtimeNanos())
            return
        }

        synchronized(lock) {
            estimator = MotionEstimator()
            haveQuat = false
        }
        lastFixNanos = SystemClock.elapsedRealtimeNanos()
        // Recorded beside them, debug builds only: the phone's own linear acceleration, to set the
        // estimator's gravity against the fusion's that soaked up a train's pull on 2026-10-09.
        val linear = sensors.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)?.takeIf { recorder.enabled }
        recorder.start(ride, listOfNotNull(linear, rotation, accel, gyro))
        val handler = HandlerThread(THREAD).also { it.start(); thread = it }.let { Handler(it.looper) }
        val events = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                synchronized(lock) {
                    when (event.sensor.type) {
                        Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                            SensorManager.getQuaternionFromVector(quat, event.values)
                            haveQuat = true
                            estimator?.onRotation(quat)
                        }
                        Sensor.TYPE_LINEAR_ACCELERATION -> if (haveQuat) recorder.imu(event.timestamp, event.values, quat)
                        Sensor.TYPE_ACCELEROMETER -> {
                            estimator?.onAccelerometer(event.timestamp, event.values)
                            recorder.accelerometer(event.timestamp, event.values)
                        }
                        Sensor.TYPE_GYROSCOPE -> {
                            estimator?.onGyroscope(event.timestamp, event.values)
                            recorder.gyroscope(event.timestamp, event.values)
                        }
                    }
                }
            }

            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
        }
        listOfNotNull(rotation, gyro, accel, linear).forEach { sensors.registerListener(events, it, SAMPLING_US, handler) }
        listener = events

        wakeLock = context.getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
            ?.apply { acquire(MAX_WAKE_MILLIS) }

        ticker = scope.launch {
            while (isActive) {
                val now = SystemClock.elapsedRealtimeNanos()
                val readout = synchronized(lock) { estimator?.readout() } ?: break
                _live.value = MotionLive(readout, unavailable = false, nowNanos = now)
                recorder.estimate(now, readout)
                if (now - lastFixNanos >= QUIET_NANOS && now - lastLineNanos >= LINE_NANOS) line(readout, gnss = null, fix = false, now)
                delay(EMIT_MILLIS)
            }
        }
    }

    fun stop() {
        ticker?.cancel()
        ticker = null
        listener?.let { context.getSystemService(SensorManager::class.java)?.unregisterListener(it) }
        listener = null
        thread?.quitSafely()
        thread = null
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        synchronized(lock) { estimator = null }
        recorder.stop()
        _live.value = null
    }

    /** A fix, as the trip got it: the estimator lines up and corrects on it, and the log notes both speeds. */
    fun onFix(fix: Fix) {
        val nanos = fix.elapsedNanos ?: SystemClock.elapsedRealtimeNanos()
        val readout = synchronized(lock) {
            val estimator = estimator ?: return
            estimator.onGnss(nanos, fix.speedMps, fix.speedAccMps, fix.bearingDeg, fix.accuracyM)
            estimator.readout()
        }
        lastFixNanos = nanos
        recorder.fix(nanos, fix)
        line(readout, gnss = fix.speedMps, fix = true, nanos)
    }

    /** A mark the rider tapped, into the recording while one runs. */
    fun mark(kind: String) {
        if (synchronized(lock) { estimator } != null) recorder.mark(kind)
    }

    private fun line(readout: MotionReadout, gnss: Float?, fix: Boolean, nanos: Long) {
        lastLineNanos = nanos
        log.event(
            "imu",
            mapOf(
                "v" to readout.imuSpeedMps?.let(::round2),
                "raw" to readout.rawSpeedMps?.let(::round2),
                "a" to readout.aLongMps2?.let(::round2),
                "gnss" to gnss,
                "aligned" to readout.aligned,
                "still" to readout.still,
                "fix" to fix,
            ),
        )
    }

    private fun round2(value: Double) = (value * 100).roundToInt() / 100.0

    private companion object {

        const val THREAD = "commute-imu"
        const val WAKE_LOCK_TAG = "commute:imu"

        /** 50 Hz. */
        const val SAMPLING_US = 20_000

        /** Twice a second to the page. */
        const val EMIT_MILLIS = 500L

        /** Without a fix this long (longer than the 5 s between close ones), a tunnel is written down... */
        const val QUIET_NANOS = 8_000_000_000L

        /** ...a line every this often. */
        const val LINE_NANOS = 5_000_000_000L

        /** Three hours, past any ride; stopping releases it sooner. */
        const val MAX_WAKE_MILLIS = 3 * 60 * 60 * 1000L
    }
}
