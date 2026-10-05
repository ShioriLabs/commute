package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.feature.trip.ActiveTrip
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The running trip on disk, written whole on every change, so a service the system killed picks up
 * where it was; and the one that last ended, so its summary outlives the process too. Small files,
 * each replaced atomically: a crash mid-write leaves the previous copy.
 */
@Singleton
class ActiveTripStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {

    private val json = Json { ignoreUnknownKeys = true }

    private val file by lazy { AtomicFile(File(context.filesDir, FILE_NAME)) }
    private val finishedFile by lazy { AtomicFile(File(context.filesDir, FINISHED_FILE_NAME)) }

    /** The stored trip, or `null` when there is none or it no longer decodes after an update. */
    fun read(): ActiveTrip? = file.read(ActiveTrip.serializer())

    fun write(trip: ActiveTrip) = file.write(ActiveTrip.serializer(), trip)

    fun clear() = file.delete()

    fun readFinished(): FinishedTrip? = finishedFile.read(FinishedTrip.serializer())

    fun writeFinished(trip: FinishedTrip) = finishedFile.write(FinishedTrip.serializer(), trip)

    fun clearFinished() = finishedFile.delete()

    private fun <T> AtomicFile.read(serializer: KSerializer<T>): T? = runCatching {
        json.decodeFromString(serializer, readFully().decodeToString())
    }.getOrNull()

    private fun <T> AtomicFile.write(serializer: KSerializer<T>, value: T) {
        val stream = startWrite()
        try {
            stream.write(json.encodeToString(serializer, value).encodeToByteArray())
            finishWrite(stream)
        } catch (e: Exception) {
            failWrite(stream)
            throw e
        }
    }

    private companion object {

        const val FILE_NAME = "active_trip.json"
        const val FINISHED_FILE_NAME = "finished_trip.json"
    }
}
