package id.shiorilabs.commute.feature.card.felica

/** Bytes written the way the manual's tables write them: hex, spaced for reading. */
internal fun hex(text: String): ByteArray = text.replace(" ", "").hexToByteArray()

internal val IDM = hex("01 2E 34 56 78 9A BC DE")
internal val PMM = hex("10 0B 4B 42 84 85 D0 FF")
