package id.shiorilabs.commute.feature.card.api

import java.time.Instant

/**
 * Which kind of card a reader recognised, which also says what its money is: rupiah on a KMT, yen
 * on a Japanese IC card. A new card type adds a value here and a reader in `:impl`.
 */
enum class CardKind { KMT, JAPAN_IC }

/**
 * One line of a card's history. [amount] is signed, in the card's money: negative is money out, and
 * money in with no [operator] is a top-up.
 */
data class CardEntry(
    val at: Instant,
    /**
     * The API's operator code (`KCI`, `LRTJBDB`, `MRTJ`, `TJ`), or on a Japanese card who ran the
     * ride, in Japanese; null when the entry names none.
     */
    val operator: String?,
    /** The station the card names (on a Japanese card, the line it rode), or null when we can't say which. */
    val place: String?,
    val amount: Long,
    /** False when the card keeps only the day: [at] is then that day's start in Jakarta. */
    val timeKnown: Boolean = true,
    /** The card being sold, with [amount] what was loaded on it. */
    val issue: Boolean = false,
)

/** What one tap told us about a card, newest entry first. */
data class CardSnapshot(
    val kind: CardKind,
    /** The last digits of the card number, never the whole of it. */
    val lastDigits: String?,
    /** In the card's money, as [CardKind] says. */
    val balance: Long,
    val entries: List<CardEntry>,
    val readAt: Instant,
)
