package id.shiorilabs.commute.feature.card.iso

import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.nfc.tech.NfcA
import android.nfc.tech.NfcB

/**
 * An NFC-A or NFC-B card as Android found it, before any command: only what the `android.nfc.tech`
 * getters give without a connection. Knows nothing of what any card's bytes mean.
 */
internal class IsoTag(
    val techs: List<String>,
    val id: ByteArray,
    val atqa: ByteArray? = null,
    val sak: Int? = null,
    val applicationData: ByteArray? = null,
    val protocolInfo: ByteArray? = null,
    val historicalBytes: ByteArray? = null,
    val hiLayerResponse: ByteArray? = null,
) {
    companion object {
        fun of(tag: Tag): IsoTag {
            val a = NfcA.get(tag)
            val b = NfcB.get(tag)
            val isoDep = IsoDep.get(tag)
            return IsoTag(
                techs = tag.techList.toList(),
                id = tag.id,
                atqa = a?.atqa,
                sak = a?.sak?.toInt(),
                applicationData = b?.applicationData,
                protocolInfo = b?.protocolInfo,
                historicalBytes = isoDep?.historicalBytes,
                hiLayerResponse = isoDep?.hiLayerResponse,
            )
        }
    }
}
