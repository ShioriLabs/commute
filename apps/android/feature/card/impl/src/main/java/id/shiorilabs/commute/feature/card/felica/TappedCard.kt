package id.shiorilabs.commute.feature.card.felica

/** A card in the field: who it said it was when Android found it, and the line to it. */
internal class TappedCard(
    val idm: ByteArray,
    val pmm: ByteArray,
    val systemCode: Int,
    val transport: FelicaTransport,
)
