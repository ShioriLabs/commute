package id.shiorilabs.commute.feature.card.presentation

import android.nfc.NfcAdapter
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.morph.NavCardMorphTarget
import id.shiorilabs.commute.feature.card.R

/**
 * The card page, opened from home's card button. It listens for a card itself, since home is
 * covered and not listening: a card touched here fills in the page in place.
 */
@Composable
internal fun CardScreen(
    innerPadding: PaddingValues,
    viewModel: CardViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val adapter = remember(context) { NfcAdapter.getDefaultAdapter(context) }
    val navigator = LocalNavigator.current
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()

    val missed = adapter != null && rememberMissedCard(adapter, viewModel::read)
    DisposableEffect(Unit) {
        viewModel.touch()
        onDispose { viewModel.touch() }
    }

    // Opened by home's white card, so the white mask is all the morph needs.
    NavCardMorphTarget(destination = Route.Card, cardTint = null) {
        CardPage(
            innerPadding = innerPadding,
            snapshot = snapshot,
            message = stringResource(
                when {
                    adapter?.isEnabled != true -> R.string.card_hold_nfc_off
                    missed -> R.string.card_tap_miss
                    else -> R.string.card_hold_message
                },
            ),
            onBack = { navigator.pop() },
        )
    }
}
