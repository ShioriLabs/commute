package id.shiorilabs.commute.feature.card.dump

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class CardDumpFilesTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val clock = Clock.fixed(Instant.parse("2026-10-23T01:02:03.456Z"), ZoneOffset.UTC)

    private val dump = CardDump(
        tag = CardDump.Tag(idm = "012E3456789ABCDE", pmm = "100B4B428485D0FF", systemCode = "0003"),
        systems = listOf(
            CardDump.SystemDump(
                code = "0003",
                idm = "012E3456789ABCDE",
                pmm = "100B4B428485D0FF",
                services = listOf(CardDump.ServiceDump(code = "090F", keyVersion = "0001", readable = true, blocks = listOf("00".repeat(16)), stop = "01A8")),
            ),
        ),
        probes = emptyList(),
        complete = true,
        transcript = listOf(CardDump.Exchange(tx = "0A0C012E3456789ABCDE", rx = "0D0D012E3456789ABCDE010003", ms = 0)),
    )

    @Test
    fun `a saved dump is named for when it was taken, in WIB, and stamped with the note and device`() {
        val files = CardDumpFiles(folder.root, clock)
        val file = files.save(dump, note = "after tap-in", device = mapOf("model" to "SM-S911B"))
        assertEquals("card-20261023-080203.json", file.name)

        val json = Json.parseToJsonElement(file.readText()).jsonObject
        assertEquals("2026-10-23T08:02:03.456+07:00", json.getValue("capturedAt").jsonPrimitive.content)
        assertEquals("after tap-in", json.getValue("note").jsonPrimitive.content)
        assertEquals(CardDump.FORMAT, json.getValue("format").jsonPrimitive.content.toInt())
    }

    @Test
    fun `what's saved reads back as the same dump`() {
        val files = CardDumpFiles(folder.root, clock)
        val read = CardDumpFiles.json.decodeFromString(CardDump.serializer(), files.save(dump, "", emptyMap()).readText())
        assertEquals(dump.systems, read.systems)
        assertEquals(dump.transcript, read.transcript)
    }

    @Test
    fun `two dumps in the same second don't overwrite each other`() {
        val files = CardDumpFiles(folder.root, clock)
        val first = files.save(dump, "", emptyMap())
        val second = files.save(dump, "", emptyMap())
        assertEquals("card-20261023-080203-2.json", second.name)
        assertEquals(listOf(first, second), files.all())
    }

    @Test
    fun `cleared, there's nothing left to share`() {
        val files = CardDumpFiles(folder.root, clock)
        files.save(dump, "", emptyMap())
        files.clear()
        assertTrue(files.all().isEmpty())
    }
}
