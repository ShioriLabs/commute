package id.shiorilabs.commute.feature.card.felica

import kotlin.math.ceil

/** T = 256 × 16 / fc, fc = 13.56 MHz: the unit a card's response time is counted in (UM §2.3.4). */
private const val T_MS = 256.0 * 16 / 13_560.0

/** Allow for a card's worst case (NFC §2.6) but no more: a lost card shouldn't hang the read. */
internal const val TIMEOUT_CAP_MS = 5_200

/**
 * The longest a card may take, given the PMm byte for that command and its n (UM §2.3.4):
 * T × ((B + 1) × n + (A + 1)) × 4^E, the byte being E (2 bits), B (3), A (3), high to low.
 */
internal fun maxResponseTimeMs(parameter: Int, n: Int): Double {
    val e = (parameter ushr 6) and 0b11
    val b = (parameter ushr 3) and 0b111
    val a = parameter and 0b111
    return T_MS * ((b + 1) * n + (a + 1)) * (1 shl (2 * e))
}

/**
 * One timeout for every command the dumper sends, from the card's own PMm: Request Service with
 * 32 nodes (D10), the fixed-time commands (D11), a full batch of reads (D13); doubled for the
 * phone's own round trip, and capped.
 */
internal fun transceiveTimeoutMs(pmm: ByteArray): Int {
    fun byte(at: Int) = pmm[at].toInt() and 0xFF
    val slowest = maxOf(
        maxResponseTimeMs(byte(2), MAX_NODES),
        maxResponseTimeMs(byte(3), 0),
        maxResponseTimeMs(byte(5), READ_BATCH),
    )
    return ceil(slowest * 2).toInt().coerceIn(100, TIMEOUT_CAP_MS)
}
