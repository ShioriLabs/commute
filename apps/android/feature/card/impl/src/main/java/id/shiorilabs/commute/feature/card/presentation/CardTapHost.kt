package id.shiorilabs.commute.feature.card.presentation

import android.nfc.NfcAdapter
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.api.CardTap
import id.shiorilabs.commute.feature.card.felica.findActivity
import id.shiorilabs.commute.feature.card.felica.readFelica
import id.shiorilabs.commute.feature.card.reader.CardReaders
import id.shiorilabs.commute.feature.card.reader.CardSession
import id.shiorilabs.commute.feature.card.reader.CardTag
import javax.inject.Inject
import kotlinx.coroutines.delay

/** Long enough to cover one read, short enough that a card pulled away is noticed (the dumper waits 10 s). */
private const val PRESENCE_CHECK_MS = 250
private const val MISS_NOTICE_MS = 3_000L
private const val GAP = 8

internal class CardTapImpl @Inject constructor(
    private val session: CardSession,
    private val readers: CardReaders,
) : CardTap {

    @Composable
    override fun Content(railHeight: Dp, modifier: Modifier) {
        val snapshot by session.snapshot.collectAsStateWithLifecycle()
        var missed by remember { mutableStateOf(false) }
        var sheetOpen by remember { mutableStateOf(false) }

        CardTapListener(
            onCard = { card ->
                val read = readers.read(CardTag.Felica(card))
                if (read != null) session.show(read) else missed = true
            },
        )
        // A card that no reader knows, or that left too soon, is said once and then forgotten.
        LaunchedEffect(missed) {
            if (missed) {
                delay(MISS_NOTICE_MS)
                missed = false
            }
        }
        // Home is the only place a read lives: it goes after five idle minutes, wherever they were spent.
        LaunchedEffect(snapshot) {
            while (true) {
                val remaining = session.idleRemaining() ?: break
                if (remaining.isNegative || remaining.isZero) {
                    session.expireIfIdle()
                    break
                }
                delay(remaining.toMillis() + 50)
            }
        }

        val current = snapshot
        Box(modifier = modifier, contentAlignment = Alignment.BottomCenter) {
            when {
                current != null -> CardPill(
                    snapshot = current,
                    onClick = {
                        session.touch()
                        sheetOpen = true
                    },
                    onDismiss = session::dismiss,
                    modifier = Modifier.padding(bottom = railHeight + GAP.dp),
                )
                missed -> CardMissNotice(
                    text = stringResource(R.string.card_tap_miss),
                    modifier = Modifier.padding(bottom = railHeight + GAP.dp),
                )
            }
        }
        if (sheetOpen && current != null) {
            CardSheet(
                snapshot = current,
                onDismiss = {
                    session.touch()
                    sheetOpen = false
                },
            )
        }
    }
}

/**
 * Reader mode while the host is resumed, and only then: it takes the NFC controller from every other
 * app, so it must let go the moment home isn't what the rider is looking at. Draws nothing and
 * listens for nothing without NFC, or with it switched off.
 */
@Composable
private fun CardTapListener(onCard: (id.shiorilabs.commute.feature.card.felica.TappedCard) -> Unit) {
    val context = LocalContext.current
    val adapter = remember(context) { NfcAdapter.getDefaultAdapter(context) }
    LifecycleResumeEffect(adapter) {
        val activity = context.findActivity()
        val on = adapter != null && activity != null && adapter.isEnabled
        if (on) adapter!!.readFelica(activity!!, PRESENCE_CHECK_MS) { onCard(it) }
        onPauseOrDispose {
            if (on) runCatching { adapter!!.disableReaderMode(activity!!) }
        }
    }
}
