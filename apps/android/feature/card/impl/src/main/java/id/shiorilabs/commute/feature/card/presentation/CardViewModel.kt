package id.shiorilabs.commute.feature.card.presentation

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.reader.CardReaders
import id.shiorilabs.commute.feature.card.reader.CardSession
import id.shiorilabs.commute.feature.card.reader.CardTag
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow

/** The card page's read, shared with home through the session. */
@HiltViewModel
internal class CardViewModel @Inject constructor(
    private val session: CardSession,
    private val readers: CardReaders,
) : ViewModel() {

    val snapshot: StateFlow<CardSnapshot?> = session.snapshot

    val readsIso: Boolean get() = readers.readsIso

    /** Whether the card was read; a read replaces whatever the session held. */
    fun read(tag: CardTag): Boolean {
        val read = readers.read(tag) ?: return false
        session.show(read)
        return true
    }

    /** Using the page counts as activity, so a read doesn't expire under the rider's eyes. */
    fun touch() = session.touch()
}
