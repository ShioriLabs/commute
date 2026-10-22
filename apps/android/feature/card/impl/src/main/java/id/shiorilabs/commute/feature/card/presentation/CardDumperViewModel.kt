package id.shiorilabs.commute.feature.card.presentation

import android.content.Intent
import androidx.annotation.WorkerThread
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.shiorilabs.commute.feature.card.dump.CardDump
import id.shiorilabs.commute.feature.card.dump.CardDumps
import id.shiorilabs.commute.feature.card.felica.DumpProgress
import id.shiorilabs.commute.feature.card.felica.FelicaDumper
import id.shiorilabs.commute.feature.card.felica.TappedCard
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CardDumperUiState(
    val phase: Phase = Phase.Waiting,
    val progress: DumpProgress? = null,
    val dump: CardDump? = null,
    /** The file the shown dump went to, once saved. */
    val savedAs: String? = null,
    val savedCount: Int = 0,
) {
    enum class Phase { Waiting, Reading, Done }
}

@HiltViewModel
class CardDumperViewModel @Inject constructor(
    private val dumps: CardDumps,
) : ViewModel() {
    private val _state = MutableStateFlow(CardDumperUiState())
    val state: StateFlow<CardDumperUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { _state.update { it.copy(savedCount = dumps.count()) } }
    }

    /**
     * Called on the NFC reader's own thread, which it holds until the card has answered
     * everything: the dump is a few hundred blocking exchanges. A card tapped mid-read is ignored.
     */
    @WorkerThread
    internal fun read(card: TappedCard) {
        val before = _state.getAndUpdate {
            if (it.phase == CardDumperUiState.Phase.Reading) it else it.copy(phase = CardDumperUiState.Phase.Reading, progress = null, dump = null, savedAs = null)
        }
        if (before.phase == CardDumperUiState.Phase.Reading) return
        val dumper = FelicaDumper(card.transport, onProgress = { progress -> _state.update { it.copy(progress = progress) } })
        val dump = dumper.dump(card.idm, card.pmm, card.systemCode)
        _state.update { it.copy(phase = CardDumperUiState.Phase.Done, progress = null, dump = dump) }
    }

    fun save(note: String) {
        val shown = _state.value
        val dump = shown.dump ?: return
        if (shown.savedAs != null) return
        // Marked before the write, so a second tap while it's under way doesn't save it twice.
        _state.update { it.copy(savedAs = "") }
        viewModelScope.launch {
            val name = dumps.save(dump, note)
            _state.update { it.copy(savedAs = name, savedCount = dumps.count()) }
        }
    }

    fun share(onReady: (Intent?) -> Unit) = viewModelScope.launch { onReady(dumps.share()) }

    fun clear() = viewModelScope.launch {
        dumps.clear()
        _state.update { it.copy(savedCount = 0, savedAs = null) }
    }

    /** Back to waiting for a card, the shown dump let go of (saved or not). */
    fun again() = _state.update {
        if (it.phase == CardDumperUiState.Phase.Reading) it else it.copy(phase = CardDumperUiState.Phase.Waiting, dump = null, savedAs = null)
    }
}
