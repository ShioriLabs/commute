package id.shiorilabs.commute.feature.trip.runtime

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.net.Uri
import android.os.SystemClock
import androidx.core.content.FileProvider
import com.github.luben.zstd.ZstdOutputStream
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.trip.TripLeg
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
 * What [MotionTracker] reads, written down as it reads it: one `.ndjson.zst` per train leg under
 * `filesDir/sensors`, with the phone, its sensors and the leg's stops in a header, then every
 * motion sample, every fix, the estimator twice a second and the rider's marks. Shared from
 * Pengaturan → Experimental beside the trip log, to replay the estimator against later. Debug
 * builds only: a release records nothing, whatever Experimental says.
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

    /** Opens the recording for [ride], read by [sensors]. */
    fun start(ride: TripLeg.Ride, sensors: List<Sensor>) {
        if (!enabled) return
        val now = clock.instant()
        val header = deviceFacts(context) + mapOf(
            "t" to STAMP.format(now),
            "n" to SystemClock.elapsedRealtimeNanos(),
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
        synchronized(lock) { runCatching { recording.start(name, header) } }
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

    fun stop() = write { recording.stop() }

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
