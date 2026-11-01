package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.felica.TappedCard
import id.shiorilabs.commute.feature.card.iso.IsoTag
import id.shiorilabs.commute.feature.card.iso.IsoTransport

/** What the phone's NFC stack handed us. A card on another technology adds a subtype. */
internal sealed interface CardTag {
    class Felica(val card: TappedCard) : CardTag

    /** An NFC-A or NFC-B card; [transport] is null without an ISO-DEP connection. */
    class Iso(val tag: IsoTag, val transport: IsoTransport?) : CardTag
}

/** One reader per card type. Returns null when the tag isn't this reader's card, or can't be read. */
internal interface CardReader {
    val kind: CardKind

    /** Whether this reader needs NFC-A and NFC-B polled for, on top of FeliCa. */
    val readsIso: Boolean get() = false

    fun read(tag: CardTag): CardSnapshot?
}
