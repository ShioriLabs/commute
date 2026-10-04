package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.feature.trip.ActiveTrip
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The running trip on disk, written whole on every change, so a service the system killed picks up
 * where it was. One small file, replaced atomically: a crash mid-write leaves the previous copy.
 */
@Singleton
class ActiveTripStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {

    private val json = Json { ignoreUnknownKeys = true }

    private val file by lazy { AtomicFile(File(context.filesDir, FILE_NAME)) }

    /** The stored trip, or `null` when there is none or it no longer decodes after an update. */
    fun read(): ActiveTrip? = runCatching {
        json.decodeFromString(ActiveTrip.serializer(), file.readFully().decodeToString())
    }.getOrNull()

    fun write(trip: ActiveTrip) {
        val stream = file.startWrite()
        try {
            stream.write(json.encodeToString(ActiveTrip.serializer(), trip).encodeToByteArray())
            file.finishWrite(stream)
        } catch (e: Exception) {
            file.failWrite(stream)
            throw e
        }
    }

    fun clear() = file.delete()

    private companion object {

        const val FILE_NAME = "active_trip.json"
    }
}
