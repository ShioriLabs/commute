package id.shiorilabs.commute.feature.card.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.reader.CardReaders
import id.shiorilabs.commute.feature.card.reader.CardSession
import id.shiorilabs.commute.feature.card.reader.CardStationNames
import id.shiorilabs.commute.feature.card.reader.CardTag
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/** The card page's read, shared with home through the session. */
@HiltViewModel
internal class CardViewModel @Inject constructor(
    private val session: CardSession,
    private val readers: CardReaders,
    stations: CardStationNames,
) : ViewModel() {

    val snapshot: StateFlow<CardSnapshot?> = session.snapshot

    /** What the stations the entries point at are called, by the API's id; empty until loaded. */
    val stationNames: StateFlow<Map<String, String>> =
        stations.names.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyMap())

    val readsIso: Boolean get() = readers.readsIso

    /** Whether the card was read; a read replaces whatever the session held. */
    fun read(tag: CardTag): Boolean {
        val read = readers.read(tag) ?: return false
        session.show(read)
        return true
    }

    /** Using the page counts as activity, so a read doesn't expire under the rider's eyes. */
    fun touch() = session.touch()

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
