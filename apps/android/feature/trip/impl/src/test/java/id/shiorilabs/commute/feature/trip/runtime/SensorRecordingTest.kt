package id.shiorilabs.commute.feature.trip.runtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.float
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SensorRecordingTest {

    @get:Rule
    val folder = TemporaryFolder()

    private val header = mapOf(
        "line" to "KCI:C",
        "stops" to listOf(mapOf("id" to "KCI-MRI", "name" to "Manggarai"), mapOf("id" to "KCI-SUD", "name" to "Sudirman")),
    )

    private fun recording(keepFiles: Int = 20, keepBytes: Long = 200_000_000) =
        SensorRecording(folder.root, keepFiles = keepFiles, keepBytes = keepBytes)

    private fun lines(file: File): List<JsonObject> = file.readLines().map { Json.parseToJsonElement(it).jsonObject }

    private val accel = floatArrayOf(0.1f, -0.2f, 0.3f)
    private val quat = floatArrayOf(1f, 0f, 0f, 0f)

    @Test
    fun `a recording opens with its header, then a line per reading`() {
        val recording = recording()
        recording.start("20261009-095512-KCI-C", header)
        recording.imu(1_000_000_000L, accel, quat)
        recording.event("gnss", 1_010_000_000L, mapOf("lat" to -6.21, "speed" to 8.1f))
        recording.stop()

        val lines = lines(recording.files().single())
        assertEquals("header", lines[0]["ev"]!!.jsonPrimitive.content)
        assertEquals("Sudirman", lines[0]["stops"]!!.jsonArray[1].jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("imu", lines[1]["ev"]!!.jsonPrimitive.content)
        assertEquals(1_000_000_000L, lines[1]["n"]!!.jsonPrimitive.long)
        assertEquals(listOf(0.1f, -0.2f, 0.3f), lines[1]["a"]!!.jsonArray.map { it.jsonPrimitive.float })
        assertEquals(listOf(1f, 0f, 0f, 0f), lines[1]["q"]!!.jsonArray.map { it.jsonPrimitive.float })
        assertEquals("gnss", lines[2]["ev"]!!.jsonPrimitive.content)
        assertEquals(1_010_000_000L, lines[2]["n"]!!.jsonPrimitive.long)
        assertEquals(8.1f, lines[2]["speed"]!!.jsonPrimitive.float)
    }

    @Test
    fun `a raw sensor's sample is a line of its own`() {
        val recording = recording()
        recording.start("20261009-095512-KCI-C", header)
        recording.vector("acc", 5L, floatArrayOf(0.4f, 9.8f, -0.1f))
        recording.stop()

        val line = lines(recording.files().single())[1]
        assertEquals("acc", line["ev"]!!.jsonPrimitive.content)
        assertEquals(5L, line["n"]!!.jsonPrimitive.long)
        assertEquals(listOf(0.4f, 9.8f, -0.1f), line["v"]!!.jsonArray.map { it.jsonPrimitive.float })
    }

    @Test
    fun `readings reach the file every few seconds, not only at the end`() {
        val recording = recording()
        recording.start("20261009-095512-KCI-C", header)
        recording.imu(0L, accel, quat)
        recording.imu(6_000_000_000L, accel, quat)
        val file = folder.root.listFiles()!!.single()
        assertEquals(3, file.readLines().size)
    }

    @Test
    fun `sharing mid-ride closes the file and carries on in a new one`() {
        val recording = recording()
        recording.start("20261009-095512-KCI-C", header)
        recording.imu(1L, accel, quat)
        val shared = recording.files()
        assertEquals(2, lines(shared.single()).size)

        recording.imu(2L, accel, quat)
        recording.stop()
        val files = recording.files()
        assertEquals(listOf("20261009-095512-KCI-C.ndjson.zst", "20261009-095512-KCI-C-2.ndjson.zst"), files.map { it.name })
        val second = lines(files[1])
        assertEquals("header", second[0]["ev"]!!.jsonPrimitive.content)
        assertEquals(2L, second[1]["n"]!!.jsonPrimitive.long)
    }

    @Test
    fun `only the newest recordings are kept`() {
        val recording = recording(keepFiles = 2)
        for (name in listOf("20261008-0900-KCI-C", "20261008-1800-KCI-C", "20261009-0930-KCI-C")) {
            recording.start(name, header)
            recording.stop()
        }
        assertEquals(listOf("20261008-1800-KCI-C.ndjson.zst", "20261009-0930-KCI-C.ndjson.zst"), recording.files().map { it.name })
    }

    @Test
    fun `past the size cap the oldest go, but never the newest`() {
        val recording = recording(keepBytes = 1)
        for (name in listOf("20261008-0900-KCI-C", "20261009-0930-KCI-C")) {
            recording.start(name, header)
            recording.imu(1L, accel, quat)
            recording.stop()
        }
        val kept = recording.files()
        assertEquals(listOf("20261009-0930-KCI-C.ndjson.zst"), kept.map { it.name })
        assertTrue(kept.single().length() > 0)
    }
}
