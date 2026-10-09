package id.shiorilabs.commute.feature.trip.runtime

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.io.OutputStream
import java.io.Writer

/**
 * One train leg's sensor readings, as NDJSON in a file of its own under [dir]: a header, then a line
 * per reading stamped `n`, nanoseconds on the clock motion sensors and fixes share. Flushed every
 * [FLUSH_NANOS] of readings, so a crash loses seconds, not the ride. The newest [keepFiles], up to
 * [keepBytes] in all, are kept. Not thread-safe: [SensorRecorder] holds its lock around every call.
 */
internal class SensorRecording(
    private val dir: File,
    private val compress: (OutputStream) -> OutputStream = { it },
    private val keepFiles: Int = KEEP_FILES,
    private val keepBytes: Long = KEEP_BYTES,
) {

    private var writer: Writer? = null
    private var current: File? = null
    private var name: String? = null
    private var header: Map<String, Any?> = emptyMap()
    private var part = 1
    private var flushedAt: Long? = null
    private val text = StringBuilder()

    /** Opens `[name].ndjson.zst`, closing any recording still open. */
    fun start(name: String, header: Map<String, Any?>) {
        stop()
        this.name = name
        this.header = header
        part = 1
        open()
    }

    /** A motion sample: linear acceleration [accel] and game rotation [quat] `[w, x, y, z]`. */
    fun imu(nanos: Long, accel: FloatArray, quat: FloatArray) {
        val out = writer ?: return
        text.setLength(0)
        text.append("{\"ev\":\"imu\",\"n\":").append(nanos).append(",\"a\":")
        floats(accel)
        text.append(",\"q\":")
        floats(quat)
        text.append("}\n")
        out.append(text)
        flushIfDue(out, nanos)
    }

    /** A raw sensor's sample, [name] at [nanos]: its [values] as `v`. */
    fun vector(name: String, nanos: Long, values: FloatArray) {
        val out = writer ?: return
        text.setLength(0)
        text.append("{\"ev\":\"").append(name).append("\",\"n\":").append(nanos).append(",\"v\":")
        floats(values)
        text.append("}\n")
        out.append(text)
        flushIfDue(out, nanos)
    }

    /** Any other reading: [name] at [nanos], with [fields]. */
    fun event(name: String, nanos: Long, fields: Map<String, Any?>) {
        val out = writer ?: return
        out.write(json(mapOf("ev" to name, "n" to nanos) + fields).toString() + "\n")
        flushIfDue(out, nanos)
    }

    fun stop() {
        writer?.close()
        writer = null
        current = null
        name = null
        prune()
    }

    /**
     * Every kept recording, oldest first, each complete: one being written is closed, and the ride
     * carries on in a new file, the same name with the next part number and the same header, which
     * isn't among them.
     */
    fun files(): List<File> {
        if (writer != null) {
            writer?.close()
            part++
            open()
        }
        return kept().filter { it != current }
    }

    private fun open() {
        dir.mkdirs()
        val base = if (part == 1) name else "$name-$part"
        val file = File(dir, "$base$SUFFIX").also { current = it }
        writer = compress(file.outputStream()).bufferedWriter()
        writer!!.write(json(mapOf("ev" to "header") + header).toString() + "\n")
        flushedAt = null
    }

    private fun flushIfDue(out: Writer, nanos: Long) {
        val last = flushedAt
        if (last == null) {
            flushedAt = nanos
        } else if (nanos - last >= FLUSH_NANOS) {
            out.flush()
            flushedAt = nanos
        }
    }

    private fun floats(values: FloatArray) {
        text.append('[')
        values.forEachIndexed { i, v ->
            if (i > 0) text.append(',')
            text.append(if (v.isFinite()) v.toString() else "null")
        }
        text.append(']')
    }

    /** Recordings, oldest first: names start with when they began. */
    private fun kept(): List<File> =
        dir.listFiles { file -> file.name.endsWith(SUFFIX) }?.sortedBy { it.name.removeSuffix(SUFFIX) }.orEmpty()

    /** Down to [keepFiles] and [keepBytes], oldest first, never the newest. */
    private fun prune() {
        val files = kept().toMutableList()
        while (files.size > 1 && (files.size > keepFiles || files.sumOf { it.length() } > keepBytes)) {
            files.removeAt(0).delete()
        }
    }

    companion object {

        const val SUFFIX = ".ndjson.zst"

        /** Readings' worth of time between flushes. */
        private const val FLUSH_NANOS = 5_000_000_000L

        private const val KEEP_FILES = 20
        private const val KEEP_BYTES = 200L * 1024 * 1024
    }
}

/** Plain values, maps and lists as JSON; anything else as its text. */
internal fun json(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is Boolean -> JsonPrimitive(value)
    is Number -> if (value is Double && !value.isFinite() || value is Float && !value.isFinite()) JsonNull else JsonPrimitive(value)
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to json(v) })
    is Iterable<*> -> JsonArray(value.map(::json))
    is FloatArray -> JsonArray(value.map(::json))
    else -> JsonPrimitive(value.toString())
}
