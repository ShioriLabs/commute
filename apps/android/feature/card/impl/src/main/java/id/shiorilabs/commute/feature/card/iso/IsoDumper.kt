package id.shiorilabs.commute.feature.card.iso

import id.shiorilabs.commute.feature.card.dump.CardDump
import id.shiorilabs.commute.feature.card.felica.hex
import java.io.IOException

/**
 * Reads what an NFC-A or NFC-B card shows before any key: what Android found, then, over ISO-DEP,
 * whether it has a Payment System Environment and, if so, every record of the files its directory
 * could be in (B1 §12.3.2). Parses nothing: the FCI and records go in the dump as the card sent
 * them. Sends only SELECT and READ RECORD, so nothing on the card can change or lock.
 */
internal class IsoDumper(
    private val transport: IsoTransport?,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private val transcript = mutableListOf<CardDump.Exchange>()
    private var started = 0L

    fun dump(tag: IsoTag): CardDump {
        transcript.clear()
        started = now()
        var pse: CardDump.PseDump? = null
        var failure: String? = null
        if (transport != null) {
            try {
                pse = readPse(transport) { pse = it }
            } catch (e: IOException) {
                failure = e.message ?: e.javaClass.simpleName
            }
        }
        return CardDump(
            iso = CardDump.IsoDump(
                techs = tag.techs.map { it.substringAfterLast('.') },
                id = tag.id.hex(),
                atqa = tag.atqa?.hex(),
                sak = tag.sak?.let { byteArrayOf(it.toByte()).hex() },
                applicationData = tag.applicationData?.hex(),
                protocolInfo = tag.protocolInfo?.hex(),
                historicalBytes = tag.historicalBytes?.hex(),
                hiLayerResponse = tag.hiLayerResponse?.hex(),
                pse = pse,
            ),
            complete = failure == null,
            failure = failure,
            transcript = transcript.toList(),
        )
    }

    /** [sofar] hears each record as it comes, so a card pulled away keeps the ones it gave. */
    private fun readPse(transport: IsoTransport, sofar: (CardDump.PseDump) -> Unit): CardDump.PseDump {
        val selected = send(transport, IsoCommand.select(IsoCommand.PSE))
        var dump = CardDump.PseDump(status = selected.status.hex4(), fci = selected.data.takeIf { selected.ok }?.hex())
        sofar(dump)
        if (!selected.ok) return dump
        for (sfi in DIRECTORY_SFIS) {
            for (record in 1..MAX_RECORD) {
                val read = send(transport, IsoCommand.readRecord(sfi, record))
                if (!read.ok) break
                dump = dump.copy(records = dump.records + CardDump.RecordDump(sfi, record, read.data.hex()))
                sofar(dump)
            }
        }
        return dump
    }

    /** Every APDU goes through here, so the transcript has all of them, answered or not. */
    private fun send(transport: IsoTransport, apdu: ByteArray): IsoResponse {
        val at = now() - started
        val answer = try {
            transport.transceive(apdu)
        } catch (e: IOException) {
            transcript += CardDump.Exchange(tx = apdu.hex(), ms = at, error = e.message ?: e.javaClass.simpleName)
            throw e
        }
        transcript += CardDump.Exchange(tx = apdu.hex(), rx = answer.hex(), ms = at)
        return IsoResponse.of(answer) ?: throw IOException("Response without a status word")
    }

    private fun Int.hex4() = byteArrayOf((this shr 8).toByte(), toByte()).hex()

    private companion object {
        /** The highest record number READ RECORD can name: a guard, not a limit any file nears. */
        const val MAX_RECORD = 254
    }
}
