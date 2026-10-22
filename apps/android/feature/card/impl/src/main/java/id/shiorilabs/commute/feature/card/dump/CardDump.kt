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
    /** The card as Android first saw it: the system it polled, that system's IDm and PMm. */
    val tag: Tag,
    val systems: List<SystemDump>,
    /** Systems a card answers polls for but leaves out of Request System Code (TN §2.1 item 10). */
    val probes: List<Probe>,
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

    @Serializable
    data class Exchange(
        val tx: String,
        val rx: String? = null,
        /** Since the dump began. */
        val ms: Long,
        val error: String? = null,
    )

    companion object {
        const val FORMAT = 1
    }
}
