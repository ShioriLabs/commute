package id.shiorilabs.commute.feature.card.felica

internal class PollingResponse(val idm: ByteArray, val pmm: ByteArray, val requestData: Int?)

internal class ReadResponse(val statusFlag1: Int, val statusFlag2: Int, val blocks: List<ByteArray>) {
    /** Both flags 00 (TN §6.1). */
    val ok: Boolean get() = statusFlag1 == 0 && statusFlag2 == 0
}

/**
 * Responses as `NfcF.transceive` returns them: the length byte, then the packet. Each reader
 * gives null for a frame it can't trust (the wrong length, response code or IDm, or cut short),
 * never an exception: a dump keeps the raw bytes either way.
 */
internal object FelicaResponse {
    /** UM §4.4.2: IDm, PMm, then 2 bytes of request data only when asked for and supported. */
    fun polling(frame: ByteArray): PollingResponse? {
        val packet = packet(frame, POLLING + 1) ?: return null
        if (packet.size != 17 && packet.size != 19) return null
        return PollingResponse(
            idm = packet.copyOfRange(1, 9),
            pmm = packet.copyOfRange(9, 17),
            requestData = if (packet.size == 19) packet.u16(17) else null,
        )
    }

    /** UM §4.4.8: the system codes, System 0 first. */
    fun requestSystemCode(frame: ByteArray, idm: ByteArray): List<Int>? {
        val packet = packet(frame, REQUEST_SYSTEM_CODE + 1, idm) ?: return null
        val count = packet.u8OrNull(9) ?: return null
        if (packet.size != 10 + 2 * count) return null
        return List(count) { packet.u16(10 + 2 * it) }
    }

    /** UM §4.4.3: a key version per node asked about, in the same order, little-endian. */
    fun requestService(frame: ByteArray, idm: ByteArray): List<Int>? {
        val packet = packet(frame, REQUEST_SERVICE + 1, idm) ?: return null
        val count = packet.u8OrNull(9) ?: return null
        if (packet.size != 10 + 2 * count) return null
        return List(count) { packet.u16le(10 + 2 * it) }
    }

    /** UM §4.4.5: the status flags, then the blocks only when the first flag is 00. */
    fun readWithoutEncryption(frame: ByteArray, idm: ByteArray): ReadResponse? {
        val packet = packet(frame, READ_WITHOUT_ENCRYPTION + 1, idm) ?: return null
        if (packet.size < 11) return null
        val flag1 = packet.u8(9)
        val flag2 = packet.u8(10)
        if (flag1 != 0) return if (packet.size == 11) ReadResponse(flag1, flag2, emptyList()) else null
        val count = packet.u8OrNull(11) ?: return null
        if (packet.size != 12 + BLOCK_SIZE * count) return null
        val blocks = List(count) { packet.copyOfRange(12 + BLOCK_SIZE * it, 12 + BLOCK_SIZE * (it + 1)) }
        return ReadResponse(flag1, flag2, blocks)
    }

    /** The packet after the length byte, if the length, response code and IDm all agree. */
    private fun packet(frame: ByteArray, responseCode: Int, idm: ByteArray? = null): ByteArray? {
        if (frame.size < 2 || frame.u8(0) != frame.size || frame.u8(1) != responseCode) return null
        val packet = frame.copyOfRange(1, frame.size)
        if (idm != null && (packet.size < 9 || !packet.copyOfRange(1, 9).contentEquals(idm))) return null
        return packet
    }

    private fun ByteArray.u8(at: Int) = this[at].toInt() and 0xFF

    private fun ByteArray.u8OrNull(at: Int) = if (at < size) u8(at) else null

    private fun ByteArray.u16(at: Int) = (u8(at) shl 8) or u8(at + 1)

    private fun ByteArray.u16le(at: Int) = u8(at) or (u8(at + 1) shl 8)
}

/** Every block is 16 bytes (UM §3.1). */
internal const val BLOCK_SIZE = 16
