package id.shiorilabs.commute.feature.card.iso

import java.io.IOException

/*
 * Command APDUs and status words from EMV 4.4 Book 1 (B1). Nothing here knows what any card's
 * applications or records mean.
 */

/** One command APDU out, its response back; ISO-DEP on a phone, a fake card in tests. */
internal fun interface IsoTransport {
    /** Blocks until the card answers. Throws when it doesn't: gone, or silent past the timeout. */
    @Throws(IOException::class)
    fun transceive(apdu: ByteArray): ByteArray
}

internal object IsoCommand {
    /** The Payment System Environment's DDF name (B1 §12.2.2). */
    val PSE = "1PAY.SYS.DDF01".encodeToByteArray()

    /** SELECT by name, first or only occurrence (B1 §11.3.2, Tables 5–7), Le '00' (B1 §11.1.1). */
    fun select(name: ByteArray): ByteArray {
        require(name.size in 5..16) { "${name.size}-byte name" }
        return byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, name.size.toByte()) + name + 0x00
    }

    /** READ RECORD [record] of the file [sfi] (B1 §11.2.2, Tables 3–4; SFIs 1–30, B1 §10.2.2). */
    fun readRecord(sfi: Int, record: Int): ByteArray {
        require(sfi in 1..30) { "SFI $sfi" }
        require(record in 1..254) { "record $record" }
        return byteArrayOf(0x00, 0xB2.toByte(), record.toByte(), ((sfi shl 3) or 0x04).toByte(), 0x00)
    }
}

/** A response APDU split into its data and its status word (B1 §11.1.2). */
internal class IsoResponse(val data: ByteArray, val status: Int) {
    val ok get() = status == SW_OK

    companion object {
        /** Null for a response too short to hold a status word. */
        fun of(apdu: ByteArray): IsoResponse? {
            if (apdu.size < 2) return null
            val sw = ((apdu[apdu.size - 2].toInt() and 0xFF) shl 8) or (apdu[apdu.size - 1].toInt() and 0xFF)
            return IsoResponse(apdu.copyOfRange(0, apdu.size - 2), sw)
        }
    }
}

/** Success (B1 §11.2.5, §11.3.5). */
internal const val SW_OK = 0x9000

/** A Payment System Directory lives in a file with an SFI of 1 to 10 (B1 §12.2.3). */
internal val DIRECTORY_SFIS = 1..10
