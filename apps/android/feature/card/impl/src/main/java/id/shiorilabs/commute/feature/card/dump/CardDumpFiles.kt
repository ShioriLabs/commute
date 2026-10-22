package id.shiorilabs.commute.feature.card.dump

import kotlinx.serialization.json.Json
import java.io.File
import java.time.Clock
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** The dumps on disk, one pretty-printed JSON file each, so two can be diffed line by line. */
internal class CardDumpFiles(private val dir: File, private val clock: Clock) {
    fun save(dump: CardDump, note: String, device: Map<String, String?>): File {
        dir.mkdirs()
        val now = clock.instant()
        val stamped = dump.copy(capturedAt = STAMP.format(now), note = note, device = device)
        val base = "card-${NAME_STAMP.format(now)}"
        val file = generateSequence(1) { it + 1 }
            .map { File(dir, if (it == 1) "$base.json" else "$base-$it.json") }
            .first { !it.exists() }
        file.writeText(json.encodeToString(CardDump.serializer(), stamped))
        return file
    }

    /** Oldest first: by the stamp in the name, then by the -2, -3 a same-second dump gets. */
    fun all(): List<File> =
        dir.listFiles { file -> NAME.matches(file.name) }
            ?.sortedWith(compareBy({ NAME.find(it.name)!!.groupValues[1] }, { NAME.find(it.name)!!.groupValues[2].toIntOrNull() ?: 1 }))
            .orEmpty()

    fun clear() {
        all().forEach { it.delete() }
    }

    companion object {
        val json = Json {
            prettyPrint = true
            encodeDefaults = true
        }

        private val NAME = Regex("""card-(\d{8}-\d{6})(?:-(\d+))?\.json""")
        private val WIB = ZoneId.of("Asia/Jakarta")
        private val STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX").withZone(WIB)
        private val NAME_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(WIB)
    }
}
