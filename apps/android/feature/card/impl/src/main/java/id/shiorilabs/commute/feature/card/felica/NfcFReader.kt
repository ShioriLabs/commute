package id.shiorilabs.commute.feature.card.felica

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.nfc.tech.NfcF
import android.os.Bundle
import id.shiorilabs.commute.feature.card.iso.IsoTag
import id.shiorilabs.commute.feature.card.iso.IsoTransport
import java.io.IOException

/**
 * Reader mode for NFC-F only, skipping the NDEF read (NFC §3.2.1), with the presence check pushed
 * well past any one command (NFC §3.3.1) so Android's own `FFFF` polls don't land mid-dump.
 * [onCard] runs on the reader's thread with the card connected, and may block there; the
 * connection closes when it returns.
 */
internal fun NfcAdapter.readFelica(
    activity: Activity,
    presenceCheckMs: Int = PRESENCE_CHECK_MS,
    onCard: (TappedCard) -> Unit,
) {
    enableReaderMode(activity, { tag -> connectFelica(tag, onCard) }, NfcAdapter.FLAG_READER_NFC_F or QUIET, extras(presenceCheckMs))
}

/**
 * The dumper's reader mode: FeliCa as [readFelica] has it, and an NFC-A or NFC-B card handed to
 * [onOther] with its ISO-DEP connected, or a null transport when it has none (or left first).
 */
internal fun NfcAdapter.readAnyCard(
    activity: Activity,
    onFelica: (TappedCard) -> Unit,
    onOther: (IsoTag, IsoTransport?) -> Unit,
) {
    val callback = NfcAdapter.ReaderCallback { tag ->
        if (NfcF.get(tag) != null) connectFelica(tag, onFelica) else connectIso(tag, onOther)
    }
    val techs = NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B
    enableReaderMode(activity, callback, techs or QUIET, extras(PRESENCE_CHECK_MS))
}

private fun connectFelica(tag: Tag, onCard: (TappedCard) -> Unit) {
    val nfcF = NfcF.get(tag) ?: return
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

private fun connectIso(tag: Tag, onCard: (IsoTag, IsoTransport?) -> Unit) {
    val found = IsoTag.of(tag)
    val isoDep = IsoDep.get(tag) ?: return onCard(found, null)
    val connected = try {
        isoDep.connect()
        true
    } catch (_: IOException) {
        false
    }
    try {
        onCard(found, if (connected) IsoTransport(isoDep::transceive) else null)
    } finally {
        runCatching { isoDep.close() }
    }
}

private fun extras(presenceCheckMs: Int) = Bundle().apply { putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, presenceCheckMs) }

private const val QUIET = NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS

/** Longer than any command's own timeout ([TIMEOUT_CAP_MS]). */
private const val PRESENCE_CHECK_MS = 10_000
