package id.shiorilabs.commute.feature.trip.runtime

import android.annotation.SuppressLint
import android.content.Context
import android.location.GnssMeasurementRequest
import android.location.GnssMeasurementsEvent
import android.location.GnssStatus
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import androidx.core.os.ExecutorCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Rekaman Detail" (Experimental): the satellites read for themselves beside the trip's own fixes,
 * into the leg's [SensorRecorder] file. The trip runs on the fused provider, whose fixes come every
 * few seconds and froze at a train's pull-out on 2026-11-02 and 03 (pinned to the centimetre at
 * 0.1 m/s while the train gathered speed for ~20 s). Recorded here, for replaying afterwards:
 * - `gps`: the satellite provider's own fix, every second;
 * - `meas`: each satellite's raw measurement, its Doppler a speed no filter has touched, rows in
 *   [MEAS_COLUMNS];
 * - `sats`: which satellites are in view, how strong, and which the fix used.
 *
 * Nothing the trip decides reads any of it. It holds a partial wake lock while it runs, as
 * [MotionTracker] does: debug builds only, where the battery is the tester's to spend.
 */
@Singleton
class RawGnssRecorder @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val recorder: SensorRecorder,
    private val log: TripLog,
) {

    private var thread: HandlerThread? = null
    private var locationListener: LocationListenerCompat? = null
    private var measurements: GnssMeasurementsEvent.Callback? = null
    private var status: GnssStatus.Callback? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var toldUnavailable = false

    /** Starts reading the satellites into the open recording, unless it's running already. */
    @SuppressLint("MissingPermission") // A trip that tracks has the permission; a SecurityException is caught.
    fun start() {
        if (!recorder.enabled || thread != null) return
        val manager = context.getSystemService(LocationManager::class.java)
        if (manager == null || !manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            unavailable("provider")
            return
        }
        val thread = HandlerThread(THREAD).also { it.start(); this.thread = it }
        val handler = Handler(thread.looper)
        val executor = ExecutorCompat.create(handler)
        try {
            val fixes = LocationListenerCompat(::onFix).also { locationListener = it }
            val request = LocationRequestCompat.Builder(INTERVAL_MILLIS)
                .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(0)
                .build()
            LocationManagerCompat.requestLocationUpdates(manager, LocationManager.GPS_PROVIDER, request, executor, fixes)

            val raw = object : GnssMeasurementsEvent.Callback() {
                override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) = onMeasurements(event)
            }.also { measurements = it }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Full tracking: no duty cycling between fixes, else the Doppler comes in bursts.
                manager.registerGnssMeasurementsCallback(GnssMeasurementRequest.Builder().setFullTracking(true).build(), executor, raw)
            } else {
                manager.registerGnssMeasurementsCallback(raw, handler)
            }

            val sky = object : GnssStatus.Callback() {
                override fun onSatelliteStatusChanged(status: GnssStatus) = onStatus(status)
            }.also { status = it }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                manager.registerGnssStatusCallback(executor, sky)
            } else {
                manager.registerGnssStatusCallback(sky, handler)
            }
        } catch (_: SecurityException) {
            stop()
            unavailable("permission")
            return
        }
        wakeLock = context.getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
            ?.apply { acquire(MAX_WAKE_MILLIS) }
    }

    fun stop() {
        val manager = context.getSystemService(LocationManager::class.java)
        if (manager != null) {
            locationListener?.let { LocationManagerCompat.removeUpdates(manager, it) }
            measurements?.let(manager::unregisterGnssMeasurementsCallback)
            status?.let(manager::unregisterGnssStatusCallback)
        }
        locationListener = null
        measurements = null
        status = null
        thread?.quitSafely()
        thread = null
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    private fun onFix(location: Location) {
        recorder.gnss(
            "gps",
            location.elapsedRealtimeNanos,
            mapOf(
                "t" to STAMP.format(Instant.ofEpochMilli(location.time)),
                "lat" to location.latitude,
                "lon" to location.longitude,
                "alt" to location.altitude.takeIf { location.hasAltitude() },
                "acc" to location.accuracy.takeIf { location.hasAccuracy() },
                "speed" to location.speed.takeIf { location.hasSpeed() },
                "speedAcc" to location.speedAccuracyMetersPerSecond.takeIf { location.hasSpeedAccuracy() },
                "bearing" to location.bearing.takeIf { location.hasBearing() },
                "bearingAcc" to location.bearingAccuracyDegrees.takeIf { location.hasBearingAccuracy() },
                "used" to location.extras?.getInt(SATELLITES_EXTRA, -1)?.takeIf { it >= 0 },
            ),
        )
    }

    private fun onMeasurements(event: GnssMeasurementsEvent) {
        val clock = event.clock
        val nanos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && clock.hasElapsedRealtimeNanos()) {
            clock.elapsedRealtimeNanos
        } else {
            SystemClock.elapsedRealtimeNanos()
        }
        recorder.gnss(
            "meas",
            nanos,
            mapOf(
                "clock" to mapOf(
                    "time" to clock.timeNanos,
                    "fullBias" to clock.fullBiasNanos.takeIf { clock.hasFullBiasNanos() },
                    "bias" to clock.biasNanos.takeIf { clock.hasBiasNanos() },
                    "drift" to clock.driftNanosPerSecond.takeIf { clock.hasDriftNanosPerSecond() },
                    "discontinuity" to clock.hardwareClockDiscontinuityCount,
                ),
                "s" to event.measurements.map { m ->
                    listOf(
                        m.constellationType,
                        m.svid,
                        m.cn0DbHz,
                        m.pseudorangeRateMetersPerSecond,
                        m.pseudorangeRateUncertaintyMetersPerSecond,
                        m.state,
                        m.receivedSvTimeNanos,
                        m.receivedSvTimeUncertaintyNanos,
                        m.timeOffsetNanos,
                        m.accumulatedDeltaRangeState,
                        m.accumulatedDeltaRangeMeters,
                        m.accumulatedDeltaRangeUncertaintyMeters,
                        m.carrierFrequencyHz.takeIf { m.hasCarrierFrequencyHz() },
                        m.multipathIndicator,
                    )
                },
            ),
        )
    }

    private fun onStatus(status: GnssStatus) {
        recorder.gnss(
            "sats",
            SystemClock.elapsedRealtimeNanos(),
            mapOf(
                "s" to (0 until status.satelliteCount).map { i ->
                    listOf(
                        status.getConstellationType(i),
                        status.getSvid(i),
                        status.getCn0DbHz(i),
                        status.usedInFix(i),
                        status.getElevationDegrees(i),
                        status.getAzimuthDegrees(i),
                    )
                },
            ),
        )
    }

    private fun unavailable(why: String) {
        if (toldUnavailable) return
        toldUnavailable = true
        log.event("gnssRec", mapOf("unavailable" to why))
    }

    companion object {

        /** `meas` rows, column by column, as the header lists them. */
        val MEAS_COLUMNS = listOf(
            "constellation", "svid", "cn0", "prr", "prrUnc", "state", "tSv", "tSvUnc", "tOffset",
            "adrState", "adr", "adrUnc", "carrierHz", "multipath",
        )

        /** `sats` rows, column by column. */
        val SATS_COLUMNS = listOf("constellation", "svid", "cn0", "used", "elevation", "azimuth")

        private const val THREAD = "commute-gnss"
        private const val WAKE_LOCK_TAG = "commute:gnss-rec"

        /** Once a second, as fast as the satellites' own fixes come. */
        private const val INTERVAL_MILLIS = 1_000L

        /** The satellites a fix used, where the provider says. */
        private const val SATELLITES_EXTRA = "satellites"

        /** Three hours, past any ride; stopping releases it sooner. */
        private const val MAX_WAKE_MILLIS = 3 * 60 * 60 * 1000L
    }
}
