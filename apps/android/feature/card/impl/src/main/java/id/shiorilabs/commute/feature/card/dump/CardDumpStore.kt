package id.shiorilabs.commute.feature.card.dump

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.config.Environment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The card dumps a debug build keeps: saved with the rider's note, shared together, cleared.
 * They hold the card's IDm and its history, so they leave the phone only through the share sheet.
 */
@Singleton
class CardDumpStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val environment: Environment,
) : CardDumps {
    private val files = CardDumpFiles(File(context.filesDir, DIR), Clock.systemUTC())

    override suspend fun save(dump: CardDump, note: String): String = withContext(Dispatchers.IO) {
        files.save(dump, note.trim(), device()).name
    }

    override suspend fun count(): Int = withContext(Dispatchers.IO) { files.all().size }

    /** Oldest first. */
    override suspend fun share(): Intent? = withContext(Dispatchers.IO) {
        val all = files.all().takeIf { it.isNotEmpty() } ?: return@withContext null
        val authority = "${context.packageName}$AUTHORITY_SUFFIX"
        val uris = ArrayList<Uri>(all.map { FileProvider.getUriForFile(context, authority, it) })
        val send = Intent(Intent.ACTION_SEND_MULTIPLE)
            .setType(MIME)
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply {
                clipData = ClipData.newRawUri(all.first().name, uris.first()).apply {
                    uris.drop(1).forEach { addItem(ClipData.Item(it)) }
                }
            }
        Intent.createChooser(send, null)
    }

    override suspend fun clear() = withContext(Dispatchers.IO) { files.clear() }

    private fun device(): Map<String, String?> = mapOf(
        "app" to environment.appVersion,
        "maker" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "sdk" to Build.VERSION.SDK_INT.toString(),
    )

    private companion object {
        const val DIR = "card_dumps"
        const val MIME = "application/json"

        /** Matches the provider in this module's debug manifest. */
        const val AUTHORITY_SUFFIX = ".carddump"
    }
}
