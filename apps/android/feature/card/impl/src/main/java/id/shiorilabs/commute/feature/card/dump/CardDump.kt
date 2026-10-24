package id.shiorilabs.commute.feature.card.dump

import kotlinx.serialization.Serializable

/**
 * Everything a card showed without a key, as JSON to diff one tap against the next. Bytes and
 * codes are upper-case hex. The transcript keeps every frame as sent and as answered, so a dump
 * can be replayed against a parser later.
 */
@Serializable
data class CardDump(
    val format: Int = FORMAT,
    /** WIB, to the millisecond. */
    val capturedAt: String = "",
    /** What was done to the card before this tap, in the rider's words. */
    val note: String = "",
    val device: Map<String, String?> = emptyMap(),
    /** A FeliCa card as Android first saw it: the system it polled, that system's IDm and PMm. */
    val tag: Tag? = null,
    val systems: List<SystemDump> = emptyList(),
    /** Systems a card answers polls for but leaves out of Request System Code (TN §2.1 item 10). */
    val probes: List<Probe> = emptyList(),
    /** Any other card, as Android found it. */
    val iso: IsoDump? = null,
    /** False when the card left, or answered something unreadable, before the dump finished. */
    val complete: Boolean,
    val failure: String? = null,
    val transcript: List<Exchange>,
) {
    @Serializable
    data class Tag(val idm: String, val pmm: String, val systemCode: String)

    @Serializable
    data class SystemDump(
        val code: String,
        /** Null when the system didn't answer a poll for its own code. */
        val idm: String?,
        val pmm: String?,
        val services: List<ServiceDump> = emptyList(),
        val areas: List<Node> = emptyList(),
    )

    @Serializable
    data class ServiceDump(
        val code: String,
        val keyVersion: String,
        /** No key needed (an odd attribute, UM Table 3-2): read in full. */
        val readable: Boolean,
        val blocks: List<String> = emptyList(),
        /** The status flags that ended the read; the last block read is the one before. */
        val stop: String? = null,
    )

    @Serializable
    data class Node(val code: String, val keyVersion: String)

    @Serializable
    data class Probe(val code: String, val idm: String? = null, val pmm: String? = null)

    /**
     * An NFC-A or NFC-B card. The fields up to [pse] are what it told Android before any command:
     * each is the getter of the same name on its `android.nfc.tech` class, null when the card has
     * no such tech.
     */
    @Serializable
    data class IsoDump(
        /** Short class names, as `Tag.getTechList` orders them. */
        val techs: List<String>,
        val id: String,
        val atqa: String? = null,
        val sak: String? = null,
        val applicationData: String? = null,
        val protocolInfo: String? = null,
        val historicalBytes: String? = null,
        val hiLayerResponse: String? = null,
        /** Null when the card has no ISO-DEP to send the SELECT over. */
        val pse: PseDump? = null,
    )

    /** The Payment System Environment (B1 §12.2.2), as the card answered its SELECT. */
    @Serializable
    data class PseDump(
        /** The status word: '9000' when the card has one, '6A82' when it hasn't (B1 §12.3.2). */
        val status: String,
        /** The FCI, unparsed (B1 Table 8). */
        val fci: String? = null,
        /** Every record of SFIs 1 to 10, where the directory has to be (B1 §12.2.3). */
        val records: List<RecordDump> = emptyList(),
    )

    @Serializable
    data class RecordDump(val sfi: Int, val record: Int, val data: String)

    @Serializable
    data class Exchange(
        val tx: String,
        val rx: String? = null,
        /** Since the dump began. */
        val ms: Long,
        val error: String? = null,
    )

    companion object {
        /** 2: [tag] is absent for an NFC-A or NFC-B card, which has [iso] instead. */
        const val FORMAT = 2
    }
}
