package id.shiorilabs.commute.feature.card.iso

import id.shiorilabs.commute.feature.card.felica.hex
import java.io.IOException

/**
 * A contactless smart card that answers SELECT by name and READ RECORD as EMV Book 1 §11 codes
 * them, from [files] (DF name to its FCI) and [records] (SFI to its records, from record 1).
 * Anything else is refused. [loseAfter] commands in, it stops answering, like a card pulled away.
 */
internal class FakeIsoCard(
    private val files: Map<String, ByteArray> = emptyMap(),
    private val records: Map<Int, List<ByteArray>> = emptyMap(),
    private val loseAfter: Int = Int.MAX_VALUE,
) : IsoTransport {
    var exchanges = 0
        private set

    override fun transceive(apdu: ByteArray): ByteArray {
        if (exchanges++ >= loseAfter) throw IOException("Tag was lost.")
        val ins = apdu[1].toInt() and 0xFF
        return when {
            ins == 0xA4 && apdu[2] == 0x04.toByte() -> {
                val name = apdu.copyOfRange(5, 5 + apdu[4]).decodeToString()
                files[name]?.let { it + OK } ?: NOT_FOUND
            }
            ins == 0xB2 && (apdu[3].toInt() and 0x07) == 0x04 -> {
                val file = records[(apdu[3].toInt() and 0xFF) shr 3] ?: return NOT_FOUND
                file.getOrNull((apdu[2].toInt() and 0xFF) - 1)?.let { it + OK } ?: NO_RECORD
            }
            else -> hex("6D 00")
        }
    }

    companion object {
        val OK = hex("90 00")
        val NOT_FOUND = hex("6A 82")
        val NO_RECORD = hex("6A 83")
    }
}
