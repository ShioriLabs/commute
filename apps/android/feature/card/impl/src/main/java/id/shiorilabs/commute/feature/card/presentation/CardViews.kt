package id.shiorilabs.commute.feature.card.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.Instant

private val CardLight = Color(0xFFECECEE)
private val CardAccent = Color(0xFF3FAE6D)

/** The card's face, drawn small: grey with a green corner. Generic on purpose, not any issuer's art. */
private fun cardFace(): Brush = Brush.linearGradient(
    0f to CardLight,
    0.55f to CardLight,
    0.55f to CardAccent,
    1f to CardAccent,
)

/** What a read left on home: the card and its balance, swiped away when it's done with. */
@Composable
internal fun CardPill(
    snapshot: CardSnapshot,
    onClick: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val balance = formatBalance(snapshot.balanceRupiah)
    val description = stringResource(R.string.card_pill_description, balance)
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value != SwipeToDismissBoxValue.Settled) onDismiss()
            true
        },
    )
    SwipeToDismissBox(
        state = state,
        backgroundContent = {},
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerLowest)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
                .clickable(onClick = onClick)
                .semantics { contentDescription = description }
                .padding(start = 8.dp, top = 8.dp, end = 18.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .size(width = 36.dp, height = 24.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(cardFace()),
            )
            Column {
                Text(
                    text = stringResource(R.string.card_pill_label_kmt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = balance,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
    }
}

/** Said when a card was touched but not read, so the rider knows to try again rather than wonder. */
@Composable
internal fun CardMissNotice(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** The card's detail: its face with the balance, the last ride, then the rest of its history. */
@Composable
internal fun CardSheet(snapshot: CardSnapshot, onDismiss: () -> Unit) {
    CommuteBottomSheet(
        title = stringResource(R.string.card_sheet_title),
        closeDescription = stringResource(R.string.card_sheet_close),
        onDismiss = onDismiss,
    ) {
        CardSheetContent(snapshot)
    }
}

@Composable
private fun CardSheetContent(snapshot: CardSnapshot) {
    LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 32.dp)) {
        item { CardTile(snapshot, Modifier.padding(horizontal = 32.dp)) }
        val last = snapshot.entries.firstOrNull()
        if (last == null) {
            item {
                Text(
                    text = stringResource(R.string.card_history_empty),
                    modifier = Modifier.padding(horizontal = 32.dp, vertical = 24.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            item { SectionHeader(stringResource(R.string.card_last_ride)) }
            item { EntryRow(last, snapshot.readAt) }
            if (snapshot.entries.size > 1) {
                item { SectionHeader(stringResource(R.string.card_history)) }
                items(snapshot.entries.drop(1)) { EntryRow(it, snapshot.readAt) }
            }
        }
    }
}

@Composable
private fun CardTile(snapshot: CardSnapshot, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(120.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(cardFace()),
    ) {
        Text(
            text = stringResource(R.string.card_pill_label_kmt),
            modifier = Modifier.padding(start = 16.dp, top = 12.dp),
            style = MaterialTheme.typography.labelMedium,
            color = Color(0xFF555555),
        )
        snapshot.lastDigits?.let {
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
            text = formatBalance(snapshot.balanceRupiah),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 16.dp, bottom = 12.dp),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.ExtraBold,
            color = Color(0xFF111111),
        )
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        modifier = Modifier.padding(start = 32.dp, top = 24.dp, end = 32.dp, bottom = 8.dp),
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
            .padding(horizontal = 32.dp, vertical = 10.dp),
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

@Preview
@Composable
private fun CardPillPreview() {
    CommutePreviewScaffold {
        CardPill(PreviewCard, onClick = {}, onDismiss = {}, modifier = Modifier.padding(16.dp))
    }
}

@Preview(heightDp = 760)
@Composable
private fun CardSheetPreview() {
    CommutePreviewScaffold {
        Column(Modifier.width(360.dp)) { CardSheetContent(PreviewCard) }
    }
}
