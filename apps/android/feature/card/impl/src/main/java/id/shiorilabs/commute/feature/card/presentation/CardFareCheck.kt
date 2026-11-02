package id.shiorilabs.commute.feature.card.presentation

import android.nfc.NfcAdapter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Amber700
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.api.CardFareCheck
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import id.shiorilabs.commute.feature.card.reader.CardReaders
import id.shiorilabs.commute.feature.card.reader.CardSession
import javax.inject.Inject

/** What a card's balance comes to against a trip, the way back taken to cost the same again. */
internal sealed interface CardBudget {
    data class RoundTrip(val left: Long) : CardBudget

    data class OneWay(val left: Long) : CardBudget

    data class Short(val missing: Long) : CardBudget

    /** The card's money can't be held against a fare in rupiah. */
    data object NotRupiah : CardBudget
}

internal fun cardBudget(card: CardSnapshot, fare: Int): CardBudget {
    if (card.kind == CardKind.JAPAN_IC) return CardBudget.NotRupiah
    val left = card.balance - fare
    return when {
        left < 0 -> CardBudget.Short(-left)
        left < fare -> CardBudget.OneWay(left)
        else -> CardBudget.RoundTrip(left)
    }
}

internal class CardFareCheckImpl @Inject constructor(
    private val session: CardSession,
    private val readers: CardReaders,
) : CardFareCheck {

    @Composable
    override fun Content(fare: Int, modifier: Modifier) {
        val context = LocalContext.current
        val adapter = remember(context) { NfcAdapter.getDefaultAdapter(context) }
        // No NFC chip, no row: there's nothing it could read.
        if (adapter == null) return

        val snapshot by session.snapshot.collectAsStateWithLifecycle()
        // The buzz says a miss; the row just stays as it was.
        rememberMissedCard(adapter, readers.readsIso) { readers.read(it)?.also(session::show) != null }
        ExpireWhenIdle(session, snapshot)

        val card = snapshot
        when {
            card != null -> BudgetRow(card, cardBudget(card, fare), modifier)
            // A hint to tap would be wrong with NFC off, when a tap does nothing.
            adapter.isEnabled -> Text(
                text = stringResource(R.string.card_fare_hint),
                modifier = modifier,
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
            )
        }
    }
}

@Composable
private fun BudgetRow(card: CardSnapshot, budget: CardBudget, modifier: Modifier) {
    val label = stringResource(card.kind.label)
    val balance = formatBalance(card.balance, card.kind)
    val detail = when (budget) {
        is CardBudget.RoundTrip -> stringResource(R.string.card_fare_round_trip, formatBalance(budget.left, card.kind))
        is CardBudget.OneWay -> stringResource(R.string.card_fare_one_way, formatBalance(budget.left, card.kind))
        is CardBudget.Short -> stringResource(R.string.card_fare_short, formatBalance(budget.missing, card.kind))
        CardBudget.NotRupiah -> stringResource(R.string.card_japan_ic, balance)
    }
    val short = budget is CardBudget.Short
    val description = stringResource(R.string.card_fare_description, label, balance, detail)
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (short) {
            Icon(
                imageVector = CommuteIcons.Warning,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = Amber700,
            )
        }
        Column {
            Text(
                text = listOfNotNull(label, card.lastDigits?.let { "••$it" }).joinToString(" ") + " · $balance",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.bodySmall,
                color = if (short) Amber700 else Slate500,
            )
        }
    }
}
