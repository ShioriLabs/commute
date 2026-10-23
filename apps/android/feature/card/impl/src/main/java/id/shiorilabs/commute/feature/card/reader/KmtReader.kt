package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.felica.FelicaCommand
import id.shiorilabs.commute.feature.card.felica.FelicaResponse
import id.shiorilabs.commute.feature.card.felica.READ_BATCH
import id.shiorilabs.commute.feature.card.felica.TappedCard
import java.io.IOException
import java.time.Instant

/*
 * Kartu Multi Trip. Every offset and code below is from spec/KMT.md, which cites the card dumps it
 * was read from; a fact that isn't there doesn't go in this file.
 */

private const val KMT_SYSTEM = 0x90B7
private const val PURSE = 0x1013
private const val HISTORY = 0x200D
private const val CARD_NUMBER = 0x3009
private const val HISTORY_BLOCKS = 16
private const val LAST_DIGITS = 4
private val EPOCH_2000: Instant = Instant.parse("2000-01-01T00:00:00Z")

// The API's operator codes (core/constants has only their names, in OPERATOR_NAMES).
private const val KCI = "KCI"
private const val LRTJBDB = "LRTJBDB"
private const val MRTJ = "MRTJ"
private const val TJ = "TJ"

internal class KmtReader(private val now: () -> Instant = Instant::now) : CardReader {
    override val kind = CardKind.KMT

    override fun read(tag: CardTag): CardSnapshot? {
        val card = (tag as? CardTag.Felica)?.card ?: return null
        return try {
            val idm = FelicaResponse.polling(card.transport.transceive(FelicaCommand.polling(KMT_SYSTEM)))?.idm ?: return null
            val purse = card.readBlocks(idm, PURSE, listOf(0))?.single() ?: return null
            val history = card.readBlocks(idm, HISTORY, (0 until HISTORY_BLOCKS).toList()) ?: return null
            val number = card.readBlocks(idm, CARD_NUMBER, listOf(0))?.single()
            CardSnapshot(
                kind = kind,
                lastDigits = number?.decodeToString()?.takeIf { d -> d.all(Char::isDigit) }?.takeLast(LAST_DIGITS),
                balanceRupiah = purse.u32le(0),
                entries = history.filter { block -> block.any { it != 0.toByte() } }.map(::entry).sortedByDescending { it.at },
                readAt = now(),
            )
        } catch (e: IOException) {
            null
        }
    }

    private fun TappedCard.readBlocks(idm: ByteArray, service: Int, blocks: List<Int>): List<ByteArray>? =
        blocks.chunked(READ_BATCH).flatMap { batch ->
            val response = FelicaResponse.readWithoutEncryption(
                transport.transceive(FelicaCommand.readWithoutEncryption(idm, service, batch)),
                idm,
            )
            if (response == null || !response.ok) return null
            response.blocks
        }

    private fun entry(block: ByteArray): CardEntry {
        val amount = block.u16be(6).toLong()
        val modeAndPlace = block.copyOfRange(8, 14)
        val (operator, place) = classify(modeAndPlace)
        return CardEntry(
            at = EPOCH_2000.plusSeconds(block.u32be(0)),
            operator = operator,
            place = place,
            // D12 is 1 for money out, 0 for money in (KMT.md, "likely").
            amountRupiah = if (modeAndPlace[4].toInt() == 1) -amount else amount,
        )
    }

    /** The API's operator code and the station the entry names, either of which may be unknown. */
    private fun classify(d: ByteArray): Pair<String?, String?> {
        val b = IntArray(6) { d[it].toInt() and 0xFF }
        return when {
            b[0] == 0x00 && b[1] == 0x05 && b[2] == 0x00 && b[4] == 0x01 && b[5] == 0x01 -> LRTJBDB to LRT_STATIONS[b[3]]
            b[0] == 0x01 && b[1] == 0x16 && b[2] == 0x00 && b[3] == 0x1C -> TJ to null
            b[0] == 0x01 && b[1] == 0x16 && b[2] == 0x00 && b[3] == 0x10 -> MRTJ to null
            b[0] == 0x01 && b[2] == 0x01 && b[3] == 0x01 && b[4] == 0x01 && b[5] == 0x00 -> KCI to KRL_STATIONS[b[1]]
            else -> null to null
        }
    }

    private fun ByteArray.u16be(at: Int) = ((this[at].toInt() and 0xFF) shl 8) or (this[at + 1].toInt() and 0xFF)

    private fun ByteArray.u32be(at: Int) = (0 until 4).fold(0L) { acc, i -> (acc shl 8) or (this[at + i].toLong() and 0xFF) }

    private fun ByteArray.u32le(at: Int) = (3 downTo 0).fold(0L) { acc, i -> (acc shl 8) or (this[at + i].toLong() and 0xFF) }

    private companion object {
        // Tap-out stations seen so far (KMT.md); any other code leaves the place unnamed.
        val KRL_STATIONS = mapOf(0x26 to "Kranji", 0x48 to "Sudirman")
        val LRT_STATIONS = mapOf(0x01 to "Dukuh Atas", 0x02 to "Setiabudi", 0x03 to "Rasuna Said")
    }
}
