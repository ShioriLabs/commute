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
import java.time.LocalDate
import java.time.ZoneId

/*
 * A Japanese transit IC card, read just far enough to joke about. Every code and offset below is
 * from spec/JAPAN_IC.md, which cites the PASMO dump it was read from; a fact that isn't there
 * doesn't go in this file. Who ran a ride comes from [JapanIcLines].
 */

private const val JAPAN_IC_SYSTEM = 0x0003
private const val PURSE = 0x008B
private const val HISTORY = 0x090F
private const val HISTORY_BLOCKS = 20

/** A history slot's D0 when it's the card being issued. */
private const val ISSUE = 0x08

/** A history slot's D0 on the rail rides we've seen, the only slots whose D6–9 we know are stations. */
private val RIDES = setOf(0x16, 0x17)

/** The days are grouped in Jakarta, so a day starts there. */
private val JAKARTA: ZoneId = ZoneId.of("Asia/Jakarta")

internal class JapanIcReader(
    private val now: () -> Instant = Instant::now,
    /** A line by a station's line byte, or null when we can't name it. */
    private val lines: (Int) -> JapanLine? = { null },
) : CardReader {
    override val kind = CardKind.JAPAN_IC

    override fun read(tag: CardTag): CardSnapshot? {
        val card = (tag as? CardTag.Felica)?.card ?: return null
        if (card.systemCode != JAPAN_IC_SYSTEM) return null
        return try {
            val blocks = card.readAll() ?: return null
            CardSnapshot(
                kind = kind,
                lastDigits = null,
                // The purse's D11–12, little-endian.
                balance = blocks.first().u16le(11),
                entries = entries(blocks.drop(1)),
                readAt = now(),
            )
        } catch (e: IOException) {
            null
        }
    }

    /** The purse, then the history's slots, in as few commands as a batch allows. Null when the card refuses any. */
    private fun TappedCard.readAll(): List<ByteArray>? {
        val wanted = listOf(ServiceBlock(PURSE, 0)) + (0 until HISTORY_BLOCKS).map { ServiceBlock(HISTORY, it) }
        return wanted.chunked(READ_BATCH).flatMap { batch ->
            val response = FelicaResponse.readWithoutEncryption(transport.transceive(FelicaCommand.readWithoutEncryption(idm, batch)), idm)
            if (response == null || !response.ok || response.blocks.size != batch.size) return null
            response.blocks
        }
    }

    /**
     * The history, newest first as the card keeps it. A slot holds no amount, only the balance it
     * left (D10–11), so each amount is that less the balance the slot before it left. The oldest
     * slot of a history with room to spare is the card's first, from an empty card; a full history's
     * oldest has nothing to count from, so it's left out.
     */
    private fun entries(slots: List<ByteArray>): List<CardEntry> {
        val used = slots.filter { it.u16be(4) != 0 }
        val before = used.drop(1).map { it.u16le(10) } + if (used.size < HISTORY_BLOCKS) listOf(0L) else emptyList()
        return used.zip(before) { slot, previous ->
            val ride = ride(slot)
            CardEntry(
                at = day(slot.u16be(4)).atStartOfDay(JAKARTA).toInstant(),
                operator = ride?.let(::operator),
                place = ride?.let(::line),
                amount = slot.u16le(10) - previous,
                timeKnown = false,
                issue = slot[0].toInt() and 0xFF == ISSUE,
            )
        }
    }

    /** The lines a ride went in (D6) and out (D8) on, when it's a ride and both lines are known. */
    private fun ride(slot: ByteArray): Pair<JapanLine, JapanLine>? {
        if (slot[0].toInt() and 0xFF !in RIDES) return null
        val from = lines(slot[6].toInt() and 0xFF) ?: return null
        val to = lines(slot[8].toInt() and 0xFF) ?: return null
        return from to to
    }

    /** Who ran the ride: one company, or where it went from and to between two. */
    private fun operator(ride: Pair<JapanLine, JapanLine>): String {
        val (from, to) = ride
        return if (from.company == to.company) from.company else "${from.company} → ${to.company}"
    }

    /** The line the ride was on, or from and to when it changed; null when either has no name. */
    private fun line(ride: Pair<JapanLine, JapanLine>): String? {
        val from = ride.first.name ?: return null
        val to = ride.second.name ?: return null
        return if (from == to) from else "$from → $to"
    }

    /** D4–5: seven bits of year since 2000, four of month, five of day. */
    private fun day(bits: Int) = LocalDate.of(2000 + (bits ushr 9), (bits ushr 5) and 0x0F, bits and 0x1F)

    private fun ByteArray.u16be(at: Int) = ((this[at].toInt() and 0xFF) shl 8) or (this[at + 1].toInt() and 0xFF)

    private fun ByteArray.u16le(at: Int) = (this[at].toLong() and 0xFF) or ((this[at + 1].toLong() and 0xFF) shl 8)
}
