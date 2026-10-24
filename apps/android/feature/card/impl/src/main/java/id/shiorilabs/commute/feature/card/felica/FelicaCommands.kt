package id.shiorilabs.commute.feature.card.felica

/*
 * Generic FeliCa, as Sony publishes it. Section numbers point into spec/NOTES.md, which says where
 * each fact comes from. Nothing here knows about any particular card's services.
 */

/** Command codes. A response's code is its command's + 1 (UM §2.3.3, Table 2-3). */
internal const val POLLING = 0x00
internal const val REQUEST_SERVICE = 0x02
internal const val READ_WITHOUT_ENCRYPTION = 0x06
internal const val REQUEST_SYSTEM_CODE = 0x0C

/** Polling's system code where any system will do; only System 0 answers it (UM §4.4.2). */
internal const val ANY_SYSTEM = 0xFFFF

/** Request Service's key version for a node the card doesn't have (UM §4.4.3, Table 4-9). */
internal const val NO_SUCH_NODE = 0xFFFF

/** Nodes per Request Service (UM §4.4.3). */
internal const val MAX_NODES = 32

/** Blocks per Read Without Encryption that every FeliCa Standard product takes (TN §2.1 item 4). */
internal const val READ_BATCH = 12

/** Services per Read Without Encryption (UM §4.4.5). */
internal const val MAX_READ_SERVICES = 16

/** One block of one service, for a read across services. */
internal data class ServiceBlock(val serviceCode: Int, val block: Int)

/** Service attributes, by kind and access: an odd one needs no key (UM §3.4.1, Table 3-2). */
internal val NO_KEY_SERVICE_ATTRIBUTES = listOf(0x09, 0x0B, 0x0D, 0x0F, 0x11, 0x13, 0x15, 0x17)
internal val KEYED_SERVICE_ATTRIBUTES = NO_KEY_SERVICE_ATTRIBUTES.map { it - 1 }

/** Area attributes: one that can hold sub-areas, one that can't (UM §3.3.1, Table 3-1). */
internal val AREA_ATTRIBUTES = listOf(0x00, 0x01)

/** Service and area numbers are the code's upper 10 bits (UM §3.4.1). */
internal const val NODE_NUMBERS = 1024

/** A service or area code: its 10-bit number over its 6-bit attribute (UM §3.3.1, §3.4.1). */
internal fun serviceCode(number: Int, attribute: Int): Int = (number shl 6) or attribute

internal fun serviceNumber(code: Int): Int = code ushr 6

internal fun serviceAttribute(code: Int): Int = code and 0x3F

/**
 * Command frames as `NfcF.transceive` takes them: a length byte that counts itself, then the
 * packet. Android adds the preamble, sync code and CRC (TN Fig 3-5).
 */
internal object FelicaCommand {
    /** UM §4.4.2. A [timeSlot] of 0 asks for the one slot a lone card answers in. */
    fun polling(systemCode: Int, requestCode: Int = 0x00, timeSlot: Int = 0x00): ByteArray =
        frame(POLLING, bigEndian(systemCode), byteArrayOf(requestCode.toByte(), timeSlot.toByte()))

    /** UM §4.4.8. */
    fun requestSystemCode(idm: ByteArray): ByteArray = frame(REQUEST_SYSTEM_CODE, idm)

    /** UM §4.4.3: up to [MAX_NODES] area or service codes, each little-endian. */
    fun requestService(idm: ByteArray, nodeCodes: List<Int>): ByteArray {
        require(nodeCodes.size in 1..MAX_NODES) { "${nodeCodes.size} nodes" }
        return frame(
            REQUEST_SERVICE,
            idm,
            byteArrayOf(nodeCodes.size.toByte()),
            *nodeCodes.map(::littleEndian).toTypedArray(),
        )
    }

    /** UM §4.4.5, one service at a time: the service, then each of its [blocks] to read. */
    fun readWithoutEncryption(idm: ByteArray, serviceCode: Int, blocks: List<Int>): ByteArray =
        readWithoutEncryption(idm, blocks.map { ServiceBlock(serviceCode, it) })

    /** UM §4.4.5 across services: each service listed once, in the order [blocks] first names it. */
    fun readWithoutEncryption(idm: ByteArray, blocks: List<ServiceBlock>): ByteArray {
        require(blocks.isNotEmpty()) { "no blocks" }
        val services = blocks.map { it.serviceCode }.distinct()
        require(services.size <= MAX_READ_SERVICES) { "${services.size} services" }
        return frame(
            READ_WITHOUT_ENCRYPTION,
            idm,
            byteArrayOf(services.size.toByte()),
            *services.map(::littleEndian).toTypedArray(),
            byteArrayOf(blocks.size.toByte()),
            *blocks.map { blockListElement(serviceIndex = services.indexOf(it.serviceCode), block = it.block) }.toTypedArray(),
        )
    }

    /**
     * UM §4.2.1: D0 is the length bit (1 for two bytes), the access mode (000 for a read) and the
     * service's place in the command's list; the block number follows, little-endian past 255.
     */
    fun blockListElement(serviceIndex: Int, block: Int): ByteArray =
        if (block <= 0xFF) {
            byteArrayOf((0x80 or serviceIndex).toByte(), block.toByte())
        } else {
            byteArrayOf(serviceIndex.toByte(), block.toByte(), (block ushr 8).toByte())
        }

    private fun frame(code: Int, vararg parts: ByteArray): ByteArray {
        val length = 2 + parts.sumOf { it.size }
        return byteArrayOf(length.toByte(), code.toByte()) + parts.fold(ByteArray(0)) { all, part -> all + part }
    }

    private fun bigEndian(value: Int) = byteArrayOf((value ushr 8).toByte(), value.toByte())

    private fun littleEndian(value: Int) = byteArrayOf(value.toByte(), (value ushr 8).toByte())
}
