package id.shiorilabs.commute.feature.card.felica

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.tech.NfcF
import android.os.Bundle
import java.io.IOException

/**
 * Reader mode for NFC-F only, skipping the NDEF read (NFC §3.2.1), with the presence check pushed
 * well past any one command (NFC §3.3.1) so Android's own `FFFF` polls don't land mid-dump.
 * [onCard] runs on the reader's thread with the card connected, and may block there; the
 * connection closes when it returns.
 */
internal fun NfcAdapter.readFelica(activity: Activity, onCard: (TappedCard) -> Unit) {
    val extras = Bundle().apply { putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, PRESENCE_CHECK_MS) }
    val callback = NfcAdapter.ReaderCallback { tag ->
        val nfcF = NfcF.get(tag) ?: return@ReaderCallback
        try {
            nfcF.connect()
            val pmm = nfcF.manufacturer
            nfcF.timeout = transceiveTimeoutMs(pmm)
            val systemCode = ((nfcF.systemCode[0].toInt() and 0xFF) shl 8) or (nfcF.systemCode[1].toInt() and 0xFF)
            onCard(TappedCard(idm = tag.id, pmm = pmm, systemCode = systemCode, transport = FelicaTransport(nfcF::transceive)))
        } catch (_: IOException) {
            // Gone before the first command: nothing to dump, and the screen still waits.
        } finally {
            runCatching { nfcF.close() }
        }
    }
    enableReaderMode(
        activity,
        callback,
        NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
        extras,
    )
}

/** Longer than any command's own timeout ([TIMEOUT_CAP_MS]). */
private const val PRESENCE_CHECK_MS = 10_000
