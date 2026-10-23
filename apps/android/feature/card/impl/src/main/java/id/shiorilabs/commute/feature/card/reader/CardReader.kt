package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.felica.TappedCard

/** What the phone's NFC stack handed us. A card on another technology adds a subtype. */
internal sealed interface CardTag {
    class Felica(val card: TappedCard) : CardTag
}

/** One reader per card type. Returns null when the tag isn't this reader's card, or can't be read. */
internal interface CardReader {
    val kind: CardKind

    fun read(tag: CardTag): CardSnapshot?
}
