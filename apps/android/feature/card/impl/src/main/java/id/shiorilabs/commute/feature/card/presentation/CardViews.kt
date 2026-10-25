package id.shiorilabs.commute.feature.card.presentation

import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.paddingFrom
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.api.CardEntry
import id.shiorilabs.commute.feature.card.api.CardKind
import id.shiorilabs.commute.feature.card.api.CardSnapshot
import java.time.Instant
import kotlin.math.roundToLong

/** The art's shape, 375 x 244 px. */
private const val CARD_ASPECT = 375f / 244f

/*
 * Where the art's "KUE" sits, which the balance takes over once a card is read: its right edge
 * 34 px in from the art's, its foot 30 px up from the bottom, its letters 37 px tall.
 */
private const val LABEL_END = 34f / 375f
private const val LABEL_BOTTOM = 30f / 244f
private const val LABEL_CAP_HEIGHT = 37f / 244f

/** A digit's height as a share of its font size, for sizing the balance by the label. */
private const val CAP_HEIGHT_PER_EM = 0.72f

/** The balance is shorter than the label: "Rp7.000" at its full height reads too loud. */
private const val BALANCE_SCALE = 0.75f

/** How much of the card's width the balance may take before it shrinks, clear of the grey. */
private const val BALANCE_MAX_WIDTH = 0.62f

private val Gutter = 32.dp

/** Short enough to finish with the buzz that says the card was read. */
private const val COUNT_UP_MS = 300

/** The card itself sits closer to the edges than the text, as the app's cards do. */
private val CardMargin = 16.dp

/**
 * The card's face: our own art, not any issuer's, with its own rounded corners. [labelled] shows
 * the "KUE" that stands where the balance goes.
 */
@Composable
private fun CardArt(labelled: Boolean, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(if (labelled) R.drawable.card_face else R.drawable.card_face_blank),
        contentDescription = null,
        modifier = modifier,
        contentScale = ContentScale.FillBounds,
    )
}

/**
 * The card page: the card's face, then the last ride and history once one is read. Before that it
 * says [message] under the same face, with a word on which cards it reads, so a card read while
 * the page is open fills it in place and nothing moves. A Japanese card gets a joke over its history.
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
            item { CardTile(snapshot, Modifier.padding(horizontal = CardMargin)) }
            if (snapshot == null) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = Gutter, vertical = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = message,
                            modifier = Modifier.fillMaxWidth(),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onBackground,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = stringResource(R.string.card_kmt_only),
                            modifier = Modifier.fillMaxWidth(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            } else {
                if (snapshot.kind == CardKind.JAPAN_IC) {
                    item {
                        Text(
                            text = stringResource(R.string.card_japan_ic, formatBalance(snapshot.balance, snapshot.kind)),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = Gutter, top = 24.dp, end = Gutter),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onBackground,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                historyItems(snapshot)
            }
        }
    }
}

private fun LazyListScope.historyItems(snapshot: CardSnapshot) {
    if (snapshot.entries.isEmpty()) {
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
    for (day in historyDays(snapshot)) {
        item { DayHeader(formatDay(day.date, snapshot.readAt), formatAmount(day.total, snapshot.kind)) }
        items(day.entries) { EntryRow(it, snapshot.kind) }
    }
}

/** The name the card goes by, on its face and on home's button. */
@get:StringRes
internal val CardKind.label: Int
    get() = when (this) {
        CardKind.KMT -> R.string.card_pill_label_kmt
        CardKind.JAPAN_IC -> R.string.card_pill_label_japan_ic
    }

/**
 * The card's face, with what was read written on it once there is something to write. The balance
 * fades in where the art's "KUE" fades out, as tall as it unless that would run it into the grey.
 */
@Composable
private fun CardTile(snapshot: CardSnapshot?, modifier: Modifier = Modifier) {
    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(CARD_ASPECT),
    ) {
        CardArt(labelled = false, modifier = Modifier.fillMaxSize())
        AnimatedVisibility(visible = snapshot == null, enter = fadeIn(), exit = fadeOut()) {
            CardArt(labelled = true, modifier = Modifier.fillMaxSize())
        }
        val cardWidth = maxWidth
        val cardHeight = maxHeight
        val labelFontSize = with(LocalDensity.current) { (cardHeight * LABEL_CAP_HEIGHT * BALANCE_SCALE / CAP_HEIGHT_PER_EM).toSp() }
        // A read counts the balance up to what it found; a page opened on an earlier read just shows it.
        val balance = remember { Animatable(snapshot?.balance?.toFloat() ?: 0f) }
        LaunchedEffect(snapshot?.readAt) {
            val target = snapshot?.balance ?: return@LaunchedEffect
            balance.animateTo(target.toFloat(), tween(COUNT_UP_MS, easing = FastOutSlowInEasing))
        }
        val balanceStyle = MaterialTheme.typography.headlineMedium.copy(
            color = Color.White,
            fontSize = labelFontSize,
            fontWeight = FontWeight.ExtraBold,
        )
        AnimatedVisibility(visible = snapshot != null, enter = fadeIn(), exit = fadeOut()) {
            val shown = snapshot ?: return@AnimatedVisibility
            Box(Modifier.fillMaxSize()) {
                Text(
                    text = stringResource(shown.kind.label),
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
                BasicText(
                    text = formatBalance(balance.value.roundToLong(), shown.kind),
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(end = cardWidth * LABEL_END)
                        .widthIn(max = cardWidth * BALANCE_MAX_WIDTH)
                        // Stood on the label's foot, wherever the font puts its baseline.
                        .paddingFrom(LastBaseline, after = cardHeight * LABEL_BOTTOM),
                    style = balanceStyle,
                    maxLines = 1,
                    autoSize = TextAutoSize.StepBased(minFontSize = 14.sp, maxFontSize = labelFontSize, stepSize = 1.sp),
                )
            }
        }
    }
}

/** A day's heading, with what the day came to on the right. */
@Composable
private fun DayHeader(day: String, total: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = Gutter, top = 24.dp, end = Gutter, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = day,
            modifier = Modifier
                .weight(1f)
                .semantics { heading() },
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = total,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * An entry. A Japanese card's ride is named by its line, or else who ran it, in Japanese as the
 * table has them; anything else on it is only money in or money out.
 */
@Composable
private fun EntryRow(row: HistoryEntry, kind: CardKind) {
    val entry = row.entry
    val topUp = entry.operator == null && entry.amount > 0
    val unnamed = kind == CardKind.JAPAN_IC && entry.place == null && entry.operator == null
    val title = when {
        entry.issue -> stringResource(R.string.card_entry_issue)
        unnamed -> stringResource(if (topUp) R.string.card_entry_topup_generic else R.string.card_entry_payment)
        topUp -> stringResource(R.string.card_entry_topup)
        entry.place != null -> entry.place!!
        else -> entry.operator?.let { OPERATOR_NAMES[it] ?: it } ?: stringResource(R.string.card_entry_ride)
    }
    val balanceAfter = formatBalance(row.balanceAfter, kind)
    // A card that keeps no time says who ran the ride there instead, when the line took the title.
    val lead = if (entry.timeKnown) formatTime(entry.at) else entry.operator.takeIf { kind == CardKind.JAPAN_IC && entry.place != null }
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
                imageVector = entry.icon(topUp || unnamed),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground)
            Text(
                text = if (lead != null) {
                    stringResource(R.string.card_entry_detail, lead, balanceAfter)
                } else {
                    stringResource(R.string.card_entry_detail_no_time, balanceAfter)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = formatAmount(entry.amount, kind),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

private fun CardEntry.icon(money: Boolean): ImageVector = when {
    money -> CommuteIcons.Payment
    operator == "TJ" -> CommuteIcons.Bus
    else -> CommuteIcons.Train
}

private val PreviewNow: Instant = Instant.parse("2026-10-24T00:12:00Z")

private val PreviewCard = CardSnapshot(
    kind = CardKind.KMT,
    lastDigits = "4821",
    balance = 47_500,
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

// The PASMO dump's history (JAPAN_IC.md), as the reader makes it.
private val PreviewJapanIc = CardSnapshot(
    kind = CardKind.JAPAN_IC,
    lastDigits = null,
    balance = 59,
    entries = listOf(
        CardEntry(Instant.parse("2025-05-09T17:00:00Z"), "東日本旅客鉄道", null, -199, timeKnown = false),
        CardEntry(Instant.parse("2025-05-09T17:00:00Z"), "東日本旅客鉄道", "両毛線", -242, timeKnown = false),
        CardEntry(Instant.parse("2025-05-07T17:00:00Z"), null, null, 500, timeKnown = false, issue = true),
    ),
    readAt = PreviewNow,
)

@Preview(heightDp = 760)
@Composable
private fun CardPageJapanIcPreview() {
    CommutePreviewScaffold {
        CardPage(PaddingValues(), snapshot = PreviewJapanIc, message = "", onBack = {})
    }
}
