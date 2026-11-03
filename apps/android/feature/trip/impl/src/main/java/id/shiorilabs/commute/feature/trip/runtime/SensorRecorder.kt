package id.shiorilabs.commute.feature.trip.runtime

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.SystemClock
import androidx.core.content.FileProvider
import com.github.luben.zstd.ZstdOutputStream
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.research.MotionReadout
import id.shiorilabs.commute.feature.trip.SensorDataExport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Clock
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What [MotionTracker] and [RawGnssRecorder] read, written down as they read it: one `.ndjson.zst`
 * per leg under `filesDir/sensors`, with the phone, its sensors and the leg's stops in a header,
 * then every motion sample, every fix, the estimator twice a second and the rider's marks, and with
 * "Rekaman Detail" the satellites' own fixes and measurements. [TripService] opens and closes it, a
 * leg at a time ([recordedLeg]). Shared from Pengaturan → Experimental beside the trip log, to
 * replay the estimator against later. Debug builds only: a release records nothing, whatever
 * Experimental says.
 */
@Singleton
class SensorRecorder @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val clock: Clock,
    environment: Environment,
) : SensorDataExport {

    /** Debug builds only; [MotionTracker] reads the raw sensors only for a recording. */
    val enabled = environment.debug
    private val lock = Any()
    private val recording = SensorRecording(File(context.filesDir, DIR), compress = { ZstdOutputStream(it, COMPRESSION_LEVEL) })

    /**
     * A "Rekaman Detail" recording is open: when the trip ends, [TripService] keeps it going a
     * minute more, past the rider getting off, and stops itself after.
     */
    @Volatile
    var detailedOpen: Boolean = false
        private set

    /**
     * Opens the recording for [ride], entered in [phase]: with the motion sensors' facts when
     * [motion] reads them, and the satellites' columns when [detailed].
     */
    fun start(ride: TripLeg.Ride, motion: Boolean, detailed: Boolean, phase: TripPhase?) {
        if (!enabled) return
        val now = clock.instant()
        val sensors = if (motion) motionSensors() else emptyList()
        val header = deviceFacts(context) + mapOf(
            "t" to STAMP.format(now),
            "n" to SystemClock.elapsedRealtimeNanos(),
            "detailed" to detailed,
            "phase" to phase?.name,
            "measCols" to RawGnssRecorder.MEAS_COLUMNS.takeIf { detailed },
            "satsCols" to RawGnssRecorder.SATS_COLUMNS.takeIf { detailed },
            "line" to ride.line,
            "headsign" to ride.headsign,
            "stops" to ride.stops.map { stop ->
                mapOf(
                    "id" to stop.id,
                    "name" to stop.name,
                    "lat" to stop.latitude,
                    "lon" to stop.longitude,
                    "scheduledAt" to stop.scheduledAt?.let(STAMP::format),
                )
            },
            "sensors" to sensors.map { sensor ->
                mapOf(
                    "type" to sensor.stringType,
                    "name" to sensor.name,
                    "vendor" to sensor.vendor,
                    "range" to sensor.maximumRange,
                    "resolution" to sensor.resolution,
                    "minDelayUs" to sensor.minDelay,
                )
            },
        )
        val name = "${NAME_STAMP.format(now)}-${ride.line.replace(Regex("[^A-Za-z0-9]+"), "-")}"
        synchronized(lock) {
            runCatching { recording.start(name, header) }
            detailedOpen = detailed
        }
    }

    /** What [MotionTracker] registers: the phone's own linear acceleration too, to set the estimator's gravity against. */
    private fun motionSensors(): List<Sensor> {
        val sensors = context.getSystemService(SensorManager::class.java) ?: return emptyList()
        return listOf(Sensor.TYPE_LINEAR_ACCELERATION, Sensor.TYPE_GAME_ROTATION_VECTOR, Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE)
            .mapNotNull(sensors::getDefaultSensor)
    }

    fun imu(nanos: Long, accel: FloatArray, quat: FloatArray) = write { recording.imu(nanos, accel, quat) }

    /** The accelerometer with gravity in, to set against linear acceleration's own gravity estimate. */
    fun accelerometer(nanos: Long, values: FloatArray) = write { recording.vector("acc", nanos, values) }

    fun gyroscope(nanos: Long, values: FloatArray) = write { recording.vector("gyro", nanos, values) }

    fun fix(nanos: Long, fix: Fix) = write {
        recording.event(
            "gnss",
            nanos,
            mapOf(
                "t" to STAMP.format(fix.at),
                "lat" to fix.point.latitude,
                "lon" to fix.point.longitude,
                "acc" to fix.accuracyM,
                "speed" to fix.speedMps,
                "speedAcc" to fix.speedAccMps,
                "bearing" to fix.bearingDeg,
                "bearingAcc" to fix.bearingAccDeg,
            ),
        )
    }

    fun estimate(nanos: Long, readout: MotionReadout) = write {
        recording.event(
            "est",
            nanos,
            mapOf(
                "v" to readout.imuSpeedMps,
                "raw" to readout.rawSpeedMps,
                "aLong" to readout.aLongMps2,
                "aligned" to readout.aligned,
                "still" to readout.still,
            ),
        )
    }

    fun mark(kind: String) = write {
        recording.event("mark", SystemClock.elapsedRealtimeNanos(), mapOf("t" to STAMP.format(clock.instant()), "kind" to kind))
    }

    /** The departure detector armed at a stop ([onsetNanos] `null`), or felt the pull out of it, begun at [onsetNanos]. */
    fun departure(nanos: Long, onsetNanos: Long?) = write {
        recording.event(if (onsetNanos == null) "armed" else "departed", nanos, mapOf("onset" to onsetNanos))
    }

    /** One of [RawGnssRecorder]'s readings: `gps`, `meas` or `sats`. */
    fun gnss(name: String, nanos: Long, fields: Map<String, Any?>) = write { recording.event(name, nanos, fields) }

    fun stop() = write {
        detailedOpen = false
        recording.stop()
    }

    /** A disk that's full or gone loses the recording, never the ride. */
    private inline fun write(block: () -> Unit) {
        synchronized(lock) { runCatching(block) }
    }

    override suspend fun share(): Intent? = withContext(Dispatchers.IO) {
        if (!enabled) return@withContext null
        val files = synchronized(lock) { runCatching { recording.files() }.getOrDefault(emptyList()) }.filter { it.length() > 0 }
        if (files.isEmpty()) return@withContext null
        val uris = files.map { FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", it) }
        val send = Intent(Intent.ACTION_SEND_MULTIPLE)
            .setType(MIME)
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList<Uri>(uris))
            .putExtra(Intent.EXTRA_SUBJECT, "commute-sensors-${NAME_STAMP.format(clock.instant())}")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply {
                clipData = ClipData.newRawUri(files.first().name, uris.first()).also { clip ->
                    uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
                }
            }
        Intent.createChooser(send, null)
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        synchronized(lock) { runCatching { recording.clear() } }
        Unit
    }

    private companion object {

        /** Under filesDir; matches `trip_log_paths.xml` and the backup exclusions. */
        const val DIR = "sensors"
        const val MIME = "application/zstd"

        /** The trip log's provider. */
        const val AUTHORITY_SUFFIX = ".triplog"

        /** zstd's default, as the trip log: fast enough for 50 lines a second. */
        const val COMPRESSION_LEVEL = 3

        val NAME_STAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneId.of("Asia/Jakarta"))
    }
}
