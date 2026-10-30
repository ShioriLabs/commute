package id.shiorilabs.commute.feature.card.presentation

import android.nfc.NfcAdapter
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardRail
import id.shiorilabs.commute.feature.card.api.CardTap
import id.shiorilabs.commute.feature.card.felica.TappedCard
import id.shiorilabs.commute.feature.card.felica.findActivity
import id.shiorilabs.commute.feature.card.felica.readFelica
import id.shiorilabs.commute.feature.card.reader.CardReaders
import id.shiorilabs.commute.feature.card.reader.CardSession
import id.shiorilabs.commute.feature.card.reader.CardTag
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Long enough to cover one read, short enough that a card pulled away is noticed (the dumper waits 10 s). */
private const val PRESENCE_CHECK_MS = 250
private const val MISS_NOTICE_MS = 3_000L

internal class CardTapImpl @Inject constructor(
    private val session: CardSession,
    private val readers: CardReaders,
) : CardTap {

    @Composable
    override fun Content(rail: @Composable (CardRail) -> Unit) {
        val context = LocalContext.current
        val adapter = remember(context) { NfcAdapter.getDefaultAdapter(context) }
        // No NFC chip, no button: there's nothing it could open.
        if (adapter == null) return

        val navigator = LocalNavigator.current
        val snapshot by session.snapshot.collectAsStateWithLifecycle()
        val missed = rememberMissedCard(adapter) { readers.read(CardTag.Felica(it))?.also(session::show) != null }
        // Home is where a read lives: it goes after five idle minutes, wherever they were spent.
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
        val balance = current?.let { formatBalance(it.balance, it.kind) }
        rail(
            CardRail(
                title = stringResource(current?.kind?.label ?: R.string.card_rail_title_idle),
                subtitle = when {
                    missed -> stringResource(R.string.card_rail_subtitle_missed)
                    balance != null -> balance
                    else -> stringResource(R.string.card_rail_subtitle_idle)
                },
                description = if (balance != null) {
                    stringResource(R.string.card_rail_description_read, balance)
                } else {
                    stringResource(R.string.card_rail_description_idle)
                },
                onClick = {
                    session.touch()
                    navigator.goTo(Route.Card)
                },
                taiwan = current != null && current.kind == CardKind.KMT &&
                    isKmtEasterEgg(jakartaDate(current.readAt), current.balance),
            ),
        )
    }
}

/**
 * Listens for a card while the host is resumed, handing each to [read], which says whether it was
 * read. Each tap buzzes as soon as it's settled, one way for a read and another for a miss, so the
 * rider can take the card away without looking. Returns whether the last one wasn't read, for a few
 * seconds: said once, then forgotten.
 */
@Composable
internal fun rememberMissedCard(adapter: NfcAdapter, read: (TappedCard) -> Boolean): Boolean {
    var missed by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    // The reader calls back on its own thread; the buzz goes out on the main one.
    val scope = rememberCoroutineScope()
    CardTapListener(adapter) { card ->
        val wasRead = read(card)
        missed = !wasRead
        scope.launch { haptics.performHapticFeedback(if (wasRead) HapticFeedbackType.Confirm else HapticFeedbackType.Reject) }
    }
    LaunchedEffect(missed) {
        if (missed) {
            delay(MISS_NOTICE_MS)
            missed = false
        }
    }
    return missed
}

/**
 * Reader mode while the host is resumed, and only then: it takes the NFC controller from every other
 * app, so it must let go the moment the rider isn't looking at it. Listens for nothing with NFC
 * switched off.
 */
@Composable
private fun CardTapListener(adapter: NfcAdapter, onCard: (TappedCard) -> Unit) {
    val context = LocalContext.current
    LifecycleResumeEffect(adapter) {
        val activity = context.findActivity()
        val on = activity != null && adapter.isEnabled
        if (on) adapter.readFelica(activity!!, PRESENCE_CHECK_MS) { onCard(it) }
        onPauseOrDispose {
            if (on) runCatching { adapter.disableReaderMode(activity!!) }
        }
    }
}
