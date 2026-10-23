package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** How long a read stays on home with nobody touching it. */
internal val IDLE_LIMIT: Duration = Duration.ofMinutes(5)

/** The card the home screen is showing: the latest read, until it's swiped away or goes idle. */
@Singleton
internal class CardSession(private val now: () -> Instant) {
    @Inject constructor() : this(Instant::now)

    private val current = MutableStateFlow<CardSnapshot?>(null)
    val snapshot: StateFlow<CardSnapshot?> = current

    @Volatile
    private var lastActivity: Instant = Instant.EPOCH

    /** A new read replaces whatever was showing. */
    fun show(snapshot: CardSnapshot) {
        lastActivity = now()
        current.value = snapshot
    }

    /** The pill or the sheet was used; the idle time starts over. */
    fun touch() {
        lastActivity = now()
    }

    fun dismiss() {
        current.value = null
    }

    /** How long until [expireIfIdle] would clear the card, or null with nothing showing. */
    fun idleRemaining(): Duration? =
        current.value?.let { IDLE_LIMIT - Duration.between(lastActivity, now()) }

    fun expireIfIdle() {
        val remaining = idleRemaining() ?: return
        if (remaining <= Duration.ZERO) dismiss()
    }
}

/** Asks each reader in turn; the first that knows the card answers. */
internal class CardReaders @Inject constructor(private val readers: Set<@JvmSuppressWildcards CardReader>) {
    fun read(tag: CardTag): CardSnapshot? = readers.firstNotNullOfOrNull { it.read(tag) }
}
