package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate300
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate600
import id.shiorilabs.commute.core.ui.theme.Slate900
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.CrowdLevel
import id.shiorilabs.commute.feature.station.domain.CrowdRange

/*
 * The forecast crowding for this hour: the web's `components/density-badge`; keep them in step.
 * Status colours, never line colours, so the icon can't be mistaken for a roundel.
 */

/** Tailwind's emerald-500, amber-400, orange-500 and rose-600, as the web fills each level. */
private val LevelFills = listOf(Color(0xFF10B981), Color(0xFFFBBF24), Color(0xFFF97316), Color(0xFFE11D48))

/** Left edge of each person in the 24-unit box: 4 wide, 2 apart, 1 of margin each side. */
private val PeopleX = listOf(1f, 7f, 13f, 19f)

/** Four people, filled up to [level] in that level's colour; the rest stay grey. */
@Composable
fun CrowdIcon(level: CrowdLevel, modifier: Modifier = Modifier, size: Dp = 20.dp) {
    val fill = LevelFills[level.ordinal]
    val empty = Slate300
    Canvas(modifier = modifier.size(size)) {
        val unit = this.size.width / 24f
        PeopleX.forEachIndexed { person, x ->
            val color = if (person <= level.ordinal) fill else empty
            drawCircle(color, radius = 2f * unit, center = Offset((x + 2f) * unit, 4f * unit))
            drawRoundRect(
                color = color,
                topLeft = Offset(x * unit, 7f * unit),
                size = Size(4f * unit, 15f * unit),
                cornerRadius = CornerRadius(2f * unit),
            )
        }
    }
}

/**
 * "Perkiraan Keramaian" and one icon when the model is sure, `min ~ max` when it isn't. Plain text,
 * right-aligned, so it reads as a hint rather than a headline. The words ("Biasanya padat jam
 * segini") are what a screen reader hears; tapping opens the legend, which is how a rider learns
 * what the icons mean.
 */
@Composable
fun CrowdBadge(range: CrowdRange, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val description = stringResource(R.string.crowd_badge_description, crowdLabel(range))
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Row(
            modifier = Modifier
                .clickable(onClick = onClick)
                .clearAndSetSemantics {
                    contentDescription = description
                    role = Role.Button
                },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.crowd_title),
                modifier = Modifier.padding(end = 2.dp),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = Slate500,
            )
            CrowdIcon(range.min)
            if (!range.isSure) {
                Text(
                    text = "~",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Slate500,
                )
                CrowdIcon(range.max)
            }
        }
    }
}

/** What the icons mean: one row per level, then how to read a range. Opens tall, so no row is cut off. */
@Composable
fun CrowdLegendSheet(onDismiss: () -> Unit) {
    val note = stringResource(R.string.crowd_legend_note)
    val noteText = remember(note) { AnnotatedString.fromHtml(note) }
    CommuteBottomSheet(
        title = stringResource(R.string.crowd_title),
        closeDescription = stringResource(R.string.crowd_legend_close),
        onDismiss = onDismiss,
    ) {
        Column(
            modifier = Modifier.padding(start = 32.dp, top = 8.dp, end = 32.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CrowdLevel.entries.forEach { level ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CrowdIcon(level, size = 28.dp)
                        Text(
                            text = stringResource(crowdNameRes(level)),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color = Slate900,
                        )
                    }
                }
            }
            Text(text = noteText, style = MaterialTheme.typography.bodyMedium, color = Slate600)
        }
    }
}

/** "Biasanya padat jam segini", or both ends of an open range: the model is unsure there, and says so. */
@Composable
private fun crowdLabel(range: CrowdRange): String =
    if (range.isSure) {
        stringResource(R.string.crowd_usually, stringResource(crowdWordRes(range.min)))
    } else {
        stringResource(
            R.string.crowd_usually_range,
            stringResource(crowdWordRes(range.min)),
            stringResource(crowdWordRes(range.max)),
        )
    }

private fun crowdWordRes(level: CrowdLevel): Int = when (level) {
    CrowdLevel.LENGANG -> R.string.crowd_word_lengang
    CrowdLevel.RAMAI -> R.string.crowd_word_ramai
    CrowdLevel.PADAT -> R.string.crowd_word_padat
    CrowdLevel.SANGAT_PADAT -> R.string.crowd_word_sangat_padat
}

private fun crowdNameRes(level: CrowdLevel): Int = when (level) {
    CrowdLevel.LENGANG -> R.string.crowd_name_lengang
    CrowdLevel.RAMAI -> R.string.crowd_name_ramai
    CrowdLevel.PADAT -> R.string.crowd_name_padat
    CrowdLevel.SANGAT_PADAT -> R.string.crowd_name_sangat_padat
}

@Preview(showBackground = true)
@Composable
private fun CrowdBadgePreview() {
    CommutePreviewScaffold {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CrowdBadge(CrowdRange(CrowdLevel.RAMAI, CrowdLevel.RAMAI), onClick = {})
            CrowdBadge(CrowdRange(CrowdLevel.PADAT, CrowdLevel.SANGAT_PADAT), onClick = {})
        }
    }
}
