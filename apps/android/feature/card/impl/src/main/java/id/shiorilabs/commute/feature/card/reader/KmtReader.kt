package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.felica.FelicaCommand
import id.shiorilabs.commute.feature.card.felica.FelicaResponse
import id.shiorilabs.commute.feature.card.felica.READ_BATCH
import id.shiorilabs.commute.feature.card.felica.ServiceBlock
import id.shiorilabs.commute.feature.card.felica.TappedCard
import java.io.IOException
import java.time.Instant

/*
 * Kartu Multi Trip. Every offset and code below is from spec/KMT.md, which cites the card dumps it
 * was read from; a fact that isn't there doesn't go in this file.
 */

private const val KMT_SYSTEM = 0x90B7

/** The three services a read needs, by one of their two codes. */
private class KmtServices(val purse: Int, val history: Int, val cardNumber: Int)

// Every card seen lists the read-only codes, and one lists nothing else; the read-write codes
// are there for a card that turns out not to (KMT.md).
private val READ_ONLY = KmtServices(purse = 0x1017, history = 0x200F, cardNumber = 0x300B)
private val READ_WRITE = KmtServices(purse = 0x1013, history = 0x200D, cardNumber = 0x3009)
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
        // A KMT has the one system (KMT.md), so the IDm Android found it by is the one to read with.
        if (card.systemCode != KMT_SYSTEM) return null
        return try {
            val (purse, number, history) = card.readAll(READ_ONLY) ?: card.readAll(READ_WRITE) ?: return null
            CardSnapshot(
                kind = kind,
                lastDigits = number.single().decodeToString().takeIf { d -> d.all(Char::isDigit) }?.takeLast(LAST_DIGITS),
                balanceRupiah = purse.single().u32le(0),
                entries = history.filter { block -> block.any { it != 0.toByte() } }.map(::entry).sortedByDescending { it.at },
                readAt = now(),
            )
        } catch (e: IOException) {
            null
        }
    }

    /**
     * The purse, the card number and the history, in as few commands as a batch allows: each takes
     * blocks from all three services at once. Null when the card refuses any of them.
     */
    private fun TappedCard.readAll(services: KmtServices): Triple<List<ByteArray>, List<ByteArray>, List<ByteArray>>? {
        val wanted = listOf(ServiceBlock(services.purse, 0), ServiceBlock(services.cardNumber, 0)) +
            (0 until HISTORY_BLOCKS).map { ServiceBlock(services.history, it) }
        val blocks = wanted.chunked(READ_BATCH).flatMap { batch ->
            val response = FelicaResponse.readWithoutEncryption(transport.transceive(FelicaCommand.readWithoutEncryption(idm, batch)), idm)
            if (response == null || !response.ok || response.blocks.size != batch.size) return null
            response.blocks
        }
        return Triple(blocks.subList(0, 1), blocks.subList(1, 2), blocks.subList(2, blocks.size))
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
