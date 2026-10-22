package id.shiorilabs.commute.feature.card.felica

import java.io.IOException

/** One command out, its response back; [NfcFTransport] on a phone, a fake card in tests. */
internal fun interface FelicaTransport {
    /** Blocks until the card answers. Throws when it doesn't: gone, or silent past the timeout. */
    @Throws(IOException::class)
    fun transceive(frame: ByteArray): ByteArray
}

private val UPPER = HexFormat { upperCase = true }

/** Bytes as a dump writes them: upper-case hex, no spaces, the way the manual prints them. */
internal fun ByteArray.hex(): String = toHexString(UPPER)

/** A 2-byte code (system, service, area, key version) as 4 hex digits. */
internal fun Int.hex4(): String = toHexString(UPPER).takeLast(4)
