package id.shiorilabs.commute.feature.card.felica

import java.io.IOException

/**
 * A FeliCa card that answers as UM §4.4 says one should, for the commands the dumper sends.
 * Services are keyed by code; each holds its key version and, if it needs no key, its blocks.
 */
internal class FakeCard(
    private val systems: List<System>,
    /** Exchanges answered before the card leaves the field; the next one throws. */
    private val loseAfter: Int = Int.MAX_VALUE,
    /** Exchange numbers (0-based) whose answer comes back garbled. */
    private val garble: Set<Int> = emptySet(),
) : FelicaTransport {
    class System(
        val code: Int,
        val idm: ByteArray,
        val pmm: ByteArray = PMM,
        val listed: Boolean = true,
        val services: Map<Int, Service> = emptyMap(),
        val areas: Map<Int, Int> = emptyMap(),
    )

    class Service(val keyVersion: Int = 0x0001, val blocks: List<ByteArray> = emptyList())

    var exchanges = 0
        private set

    override fun transceive(frame: ByteArray): ByteArray {
        val n = exchanges++
        if (n >= loseAfter) throw IOException("Tag was lost.")
        val answer = answer(frame)
        return if (n in garble) answer.copyOf(answer.size - 1) else answer
    }

    private fun answer(frame: ByteArray): ByteArray {
        val code = frame.u8(1)
        if (code == POLLING) {
            val wanted = frame.u16(2)
            val system = systems.firstOrNull { matches(wanted, it.code) } ?: throw IOException("no response")
            return response(POLLING + 1, system.idm, system.pmm)
        }
        val idm = frame.copyOfRange(2, 10)
        val system = systems.first { it.idm.contentEquals(idm) }
        return when (code) {
            REQUEST_SYSTEM_CODE -> {
                val listed = systems.filter { it.listed }
                response(REQUEST_SYSTEM_CODE + 1, idm, byteArrayOf(listed.size.toByte()), *listed.map { be(it.code) }.toTypedArray())
            }
            REQUEST_SERVICE -> {
                val count = frame.u8(10)
                val versions = List(count) { frame.u16le(11 + 2 * it) }.map { node ->
                    system.services[node]?.keyVersion ?: system.areas[node] ?: NO_SUCH_NODE
                }
                response(REQUEST_SERVICE + 1, idm, byteArrayOf(count.toByte()), *versions.map(::le).toTypedArray())
            }
            READ_WITHOUT_ENCRYPTION -> read(system, frame)
            else -> throw IOException("no response")
        }
    }

    private fun read(system: System, frame: ByteArray): ByteArray {
        val idm = system.idm
        val codes = List(frame.u8(10)) { frame.u16le(11 + 2 * it) }
        var at = 11 + 2 * codes.size
        val count = frame.u8(at++)
        // Each element: the service's place in the list, and the block.
        val wanted = List(count) {
            val index = frame.u8(at) and 0x0F
            val block = if (frame.u8(at) and 0x80 != 0) frame.u8(at + 1).also { at += 2 } else frame.u16le(at + 1).also { at += 3 }
            codes[index] to block
        }
        val fail = when {
            codes.any { it !in system.services } -> 0xA6
            codes.any { serviceAttribute(it) % 2 == 0 } -> 0xA5
            wanted.any { (code, block) -> block >= system.services.getValue(code).blocks.size } -> 0xA8
            else -> 0
        }
        if (fail != 0) return response(READ_WITHOUT_ENCRYPTION + 1, idm, byteArrayOf(0x01, fail.toByte()))
        return response(
            READ_WITHOUT_ENCRYPTION + 1,
            idm,
            byteArrayOf(0, 0, count.toByte()),
            *wanted.map { (code, block) -> system.services.getValue(code).blocks[block] }.toTypedArray(),
        )
    }

    private fun matches(wanted: Int, code: Int): Boolean =
        ((wanted ushr 8) == 0xFF || (wanted ushr 8) == (code ushr 8)) && ((wanted and 0xFF) == 0xFF || (wanted and 0xFF) == (code and 0xFF))

    private fun response(code: Int, vararg parts: ByteArray): ByteArray {
        val body = parts.fold(ByteArray(0)) { all, part -> all + part }
        return byteArrayOf((body.size + 2).toByte(), code.toByte()) + body
    }

    private fun be(value: Int) = byteArrayOf((value ushr 8).toByte(), value.toByte())

    private fun le(value: Int) = byteArrayOf(value.toByte(), (value ushr 8).toByte())

    private fun ByteArray.u8(at: Int) = this[at].toInt() and 0xFF

    private fun ByteArray.u16(at: Int) = (u8(at) shl 8) or u8(at + 1)

    private fun ByteArray.u16le(at: Int) = u8(at) or (u8(at + 1) shl 8)
}

/** n distinct 16-byte blocks: block i is i repeated, so a dump shows which block went where. */
internal fun blocks(n: Int): List<ByteArray> = List(n) { i -> ByteArray(BLOCK_SIZE) { i.toByte() } }
