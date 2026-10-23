package id.shiorilabs.commute.feature.card.api

import java.time.Instant

/** Which kind of card a reader recognised. A new card type adds a value here and a reader in `:impl`. */
enum class CardKind { KMT }

/**
 * One line of a card's history. [amountRupiah] is signed: negative is money out, and money in with
 * no [operator] is a top-up.
 */
data class CardEntry(
    val at: Instant,
    /** The API's operator code (`KCI`, `LRTJBDB`, `MRTJ`, `TJ`), or null when the entry names none. */
    val operator: String?,
    /** The station the card names, or null when we can't say which. */
    val place: String?,
    val amountRupiah: Long,
)

/** What one tap told us about a card, newest entry first. */
data class CardSnapshot(
    val kind: CardKind,
    /** The last digits of the card number, never the whole of it. */
    val lastDigits: String?,
    val balanceRupiah: Long,
    val entries: List<CardEntry>,
    val readAt: Instant,
)
