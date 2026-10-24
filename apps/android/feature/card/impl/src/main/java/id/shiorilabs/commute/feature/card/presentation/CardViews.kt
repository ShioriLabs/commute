package id.shiorilabs.commute.feature.card.presentation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.Instant

/** The art's shape, 373 x 240 px. */
private const val CARD_ASPECT = 373f / 240f

private val Gutter = 32.dp

/** The card's face: our own generic art, not any issuer's. The art carries its own rounded corners. */
@Composable
private fun CardArt(modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(R.drawable.card_generic),
        contentDescription = null,
        modifier = modifier,
        contentScale = ContentScale.FillBounds,
    )
}

/**
 * The card page: the card's face, then the last ride and history once one is read. Before that it
 * says [message] under the same face, so a card read while the page is open fills it in place and
 * nothing moves.
 */
@Composable
internal fun CardPage(
    innerPadding: PaddingValues,
    snapshot: CardSnapshot?,
    message: String,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .padding(top = innerPadding.calculateTopPadding()),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = Gutter, top = Gutter, end = Gutter, bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.card_page_title),
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            CommuteCloseButton(
                onClick = onBack,
                contentDescription = stringResource(R.string.card_page_close),
                tint = MaterialTheme.colorScheme.onBackground,
            )
        }
        LazyColumn(contentPadding = PaddingValues(bottom = innerPadding.calculateBottomPadding() + 32.dp)) {
            item { CardTile(snapshot, Modifier.padding(horizontal = Gutter)) }
            if (snapshot == null) {
                item {
                    Text(
                        text = message,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = Gutter, vertical = 24.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onBackground,
                        textAlign = TextAlign.Center,
                    )
                }
            } else {
                historyItems(snapshot)
            }
        }
    }
}

private fun LazyListScope.historyItems(snapshot: CardSnapshot) {
    val last = snapshot.entries.firstOrNull()
    if (last == null) {
        item {
            Text(
                text = stringResource(R.string.card_history_empty),
                modifier = Modifier.padding(horizontal = Gutter, vertical = 24.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }
    item { SectionHeader(stringResource(R.string.card_last_ride)) }
    item { EntryRow(last, snapshot.readAt) }
    if (snapshot.entries.size > 1) {
        item { SectionHeader(stringResource(R.string.card_history)) }
        items(snapshot.entries.drop(1)) { EntryRow(it, snapshot.readAt) }
    }
}

/** The card's face, with what was read written on it once there is something to write. */
@Composable
private fun CardTile(snapshot: CardSnapshot?, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(CARD_ASPECT),
    ) {
        CardArt(Modifier.fillMaxSize())
        AnimatedVisibility(visible = snapshot != null, enter = fadeIn(), exit = fadeOut()) {
            val shown = snapshot ?: return@AnimatedVisibility
            Box(Modifier.fillMaxSize()) {
                Text(
                    text = stringResource(R.string.card_pill_label_kmt),
                    modifier = Modifier.padding(start = 16.dp, top = 12.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFF555555),
                )
                shown.lastDigits?.let {
                    Text(
                        text = stringResource(R.string.card_digits, it),
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(end = 16.dp, top = 12.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White,
                    )
                }
                Text(
                    text = formatBalance(shown.balanceRupiah),
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 16.dp, bottom = 12.dp),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.ExtraBold,
                    color = Color(0xFF111111),
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        modifier = Modifier.padding(start = Gutter, top = 24.dp, end = Gutter, bottom = 8.dp),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun EntryRow(entry: CardEntry, now: Instant) {
    val topUp = entry.operator == null && entry.amountRupiah > 0
    val title = when {
        topUp -> stringResource(R.string.card_entry_topup)
        entry.place != null -> entry.place!!
        else -> entry.operator?.let { OPERATOR_NAMES[it] ?: it } ?: stringResource(R.string.card_entry_ride)
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = entry.icon(topUp),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground)
            Text(
                text = formatEntryTime(entry.at, now),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = formatAmount(entry.amountRupiah),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

private fun CardEntry.icon(topUp: Boolean): ImageVector = when {
    topUp -> CommuteIcons.Payment
    operator == "TJ" -> CommuteIcons.Bus
    else -> CommuteIcons.Train
}

private val PreviewNow: Instant = Instant.parse("2026-10-24T00:12:00Z")

private val PreviewCard = CardSnapshot(
    kind = CardKind.KMT,
    lastDigits = "4821",
    balanceRupiah = 47_500,
    entries = listOf(
        CardEntry(Instant.parse("2026-10-23T11:42:00Z"), "KCI", "Sudirman", -3_000),
        CardEntry(Instant.parse("2026-10-23T01:05:00Z"), "TJ", null, -3_500),
        CardEntry(Instant.parse("2026-10-22T10:20:00Z"), "LRTJBDB", "Rasuna Said", -5_000),
        CardEntry(Instant.parse("2026-10-22T00:50:00Z"), null, null, 50_000),
        CardEntry(Instant.parse("2026-10-21T11:10:00Z"), null, null, -1_000),
    ),
    readAt = PreviewNow,
)

@Preview(heightDp = 760)
@Composable
private fun CardPageHoldPreview() {
    CommutePreviewScaffold {
        CardPage(PaddingValues(), snapshot = null, message = stringResource(R.string.card_hold_message), onBack = {})
    }
}

@Preview(heightDp = 760)
@Composable
private fun CardPageReadPreview() {
    CommutePreviewScaffold {
        CardPage(PaddingValues(), snapshot = PreviewCard, message = "", onBack = {})
    }
}
