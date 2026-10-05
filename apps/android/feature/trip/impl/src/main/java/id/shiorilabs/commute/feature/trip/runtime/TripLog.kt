package id.shiorilabs.commute.feature.trip.runtime

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import com.github.luben.zstd.ZstdOutputStream
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.feature.trip.TripLogExport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.File
import java.time.Clock
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/** What the trip did and why, one event at a time: a name, and its facts as plain values. */
fun interface TripLog {

    fun event(name: String, fields: Map<String, Any?>)
}

/**
 * [TripLog] to logcat (`adb logcat -s CommuteTrip`) and, as NDJSON, to a file of its own, which
 * outlives the process and logcat's rotation and is shared from Pengaturan → Experimental as
 * `.ndjson.zst`. Past [MAX_BYTES] the older half goes.
 */
@Singleton
class FileTripLog @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val clock: Clock,
) : TripLog, TripLogExport {

    private val file by lazy { File(context.filesDir, FILE_NAME) }
    private val lock = Any()

    override fun event(name: String, fields: Map<String, Any?>) {
        Log.i(TAG, fields.entries.joinToString(" ", prefix = "$name ") { (key, value) -> "$key=$value" })
        val line = line(STAMP.format(clock.instant()), name, fields)
        synchronized(lock) {
            runCatching {
                file.appendText(line)
                if (file.length() > MAX_BYTES) keepNewest()
            }
        }
    }

    /** The newer half, from the start of a line. */
    private fun keepNewest() {
        val bytes = file.readBytes()
        val tail = bytes.copyOfRange(bytes.size - MAX_BYTES / 2, bytes.size)
        val from = tail.indexOf('\n'.code.toByte()) + 1
        file.writeBytes(tail.copyOfRange(from, tail.size))
    }

    override suspend fun share(): Intent? = withContext(Dispatchers.IO) {
        val log = synchronized(lock) { file.takeIf { it.exists() && it.length() > 0 }?.readBytes() } ?: return@withContext null
        val dir = File(context.cacheDir, SHARED_DIR).apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val now = clock.instant()
        val copy = File(dir, "commute-trip-${NAME_STAMP.format(now)}.ndjson.zst")
        ZstdOutputStream(copy.outputStream(), COMPRESSION_LEVEL).use { out ->
            out.write(line(STAMP.format(now), "device", device()).encodeToByteArray())
            out.write(log)
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", copy)
        val send = Intent(Intent.ACTION_SEND)
            .setType(MIME)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, copy.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = ClipData.newRawUri(copy.name, uri) }
        Intent.createChooser(send, null)
    }

    /** Which build, on which phone: what a log read later can't tell by itself. */
    private fun device(): Map<String, Any?> {
        val app = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
        return mapOf(
            "app" to app?.versionName,
            "package" to context.packageName,
            "maker" to Build.MANUFACTURER,
            "model" to Build.MODEL,
            "android" to Build.VERSION.RELEASE,
            "sdk" to Build.VERSION.SDK_INT,
        )
    }

    companion object {

        /** `adb logcat -s CommuteTrip`: what a field test needs to tell why a trip did what it did. */
        const val TAG = "CommuteTrip"

        private const val FILE_NAME = "trip_log.ndjson"
        private const val SHARED_DIR = "logs"
        private const val MIME = "application/zstd"

        /** Matches the provider in this module's manifest. */
        private const val AUTHORITY_SUFFIX = ".triplog"

        /** About a day out of fixes every few seconds. */
        private const val MAX_BYTES = 1_000_000

        /** zstd's own default: a log of repeated keys shrinks a lot even at this. */
        private const val COMPRESSION_LEVEL = 3

        private val STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX").withZone(ZoneId.of("Asia/Jakarta"))
        private val NAME_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").withZone(ZoneId.of("Asia/Jakarta"))
    }
}

/** One NDJSON line: when (`t`, WIB), what (`ev`), then [fields] as JSON values. */
internal fun line(at: String, name: String, fields: Map<String, Any?>): String = buildJsonObject {
    put("t", JsonPrimitive(at))
    put("ev", JsonPrimitive(name))
    fields.forEach { (key, value) ->
        put(
            key,
            when (value) {
                null -> JsonNull
                is Boolean -> JsonPrimitive(value)
                is Number -> JsonPrimitive(value)
                else -> JsonPrimitive(value.toString())
            },
        )
    }
}.toString() + "\n"
