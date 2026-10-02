package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.api.R
import id.shiorilabs.commute.feature.station.domain.DayQualifier
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.OPERATOR_TJ
import id.shiorilabs.commute.feature.station.domain.ServiceHours
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import id.shiorilabs.commute.feature.station.domain.dayQualifier
import id.shiorilabs.commute.feature.station.domain.dottedTime
import id.shiorilabs.commute.feature.station.domain.groupByCorridor
import id.shiorilabs.commute.feature.station.domain.headwayMinutes

/** While the line dictionary is still loading: the row renders grey rather than blanking. */
private val FallbackLineColor = Color(0xFF94A3B8)

// Tailwind's greys, as the web's frequency card uses them.
private val Slate700 = Color(0xFF334155)
private val Slate500 = Color(0xFF64748B)
private val Gray600 = Color(0xFF4B5563)

/** The roundel's width and the gap after it: where a corridor's directions indent to. */
private val NameColumnStart = 16.dp + 24.dp + 12.dp

/**
 * What stands in for a halte's timetable: how often each corridor passes, or, with nothing to show
 * ([frequencies] null or empty), the note that TransJakarta publishes no schedule. A failed request
 * lands on the note too, as on the web: it is the same answer the page gave before frequencies.
 */
@Composable
fun HalteFrequencies(
    frequencies: List<Frequency>?,
    lines: Map<String, LineInfo>,
    modifier: Modifier = Modifier,
) {
    if (frequencies.isNullOrEmpty()) {
        NoScheduleNote(modifier)
    } else {
        FrequencyList(frequencies, lines, modifier)
    }
}

/**
 * How often each corridor passes a halte: the web's `FrequencyList`. One panel rather than a card per
 * corridor, since a frequency is a short phrase and not a departure board, but each corridor's row is
 * tinted with its own colour, which is how a rider picks theirs out before reading a word.
 *
 * A frequency, never an arrival, and the footnote keeps saying so.
 */
@Composable
fun FrequencyList(
    frequencies: List<Frequency>,
    lines: Map<String, LineInfo>,
    modifier: Modifier = Modifier,
) {
    val corridors = remember(frequencies) { groupByCorridor(frequencies) }
    val description = stringResource(R.string.frequency_description)
    val shape = MaterialTheme.shapes.medium

    Column(modifier = modifier.semantics { contentDescription = description }) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(8.dp, shape)
                .clip(shape)
                .background(Color.White),
        ) {
            corridors.forEachIndexed { index, rows ->
                if (index > 0) {
                    HorizontalDivider(thickness = 2.dp, color = Color.White)
                }
                CorridorRows(rows, lines[rows.first().lineKey])
            }
        }
        Text(
            text = stringResource(R.string.frequency_disclaimer),
            modifier = Modifier.padding(start = 4.dp, top = 12.dp, end = 4.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = Gray600,
        )
    }
}

/**
 * One corridor: its roundel and name once, then its frequency. Inline beside the name when it holds
 * both ways; otherwise a row per direction under the name, "arah <terminus>" as the halte's own
 * board words it. A single labelled row is a halte the corridor only passes one way, and gets its
 * own row too, so it doesn't read as holding both ways.
 */
@Composable
private fun CorridorRows(rows: List<Frequency>, lineInfo: LineInfo?) {
    val first = rows.first()
    val lineCode = lineInfo?.lineCode ?: codeOfLineKey(first.lineKey)
    val lineName = lineInfo?.name ?: lineCode.ifEmpty { stringResource(R.string.line_card_fallback_name) }
    val lineColor = lineInfo?.let { parseHexColor(it.colorCode) } ?: FallbackLineColor
    val inline = rows.size == 1 && first.boundFor == null

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(lineColor.tint(0.1f))
            .padding(bottom = if (inline) 0.dp else 8.dp),
    ) {
        // Top-aligned: the roundel and the frequency belong to the name's first line, wherever a
        // long name wraps.
        Row(
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp, bottom = if (inline) 12.dp else 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            LineRoundel(
                code = lineCode,
                color = lineInfo?.colorCode ?: "#94A3B8",
                operator = lineInfo?.operator ?: OPERATOR_TJ,
                size = RoundelSize.SM,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = lineName,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                serviceHoursLabel(first.serviceHours)?.let { hours ->
                    Text(text = hours, style = MaterialTheme.typography.bodySmall, color = Slate500)
                }
            }
            // The name yields and the frequency doesn't: it is the reason the row exists.
            if (inline) {
                FrequencyFigure(first, Modifier.padding(top = 2.dp))
            }
        }
        if (!inline) {
            rows.forEach { row ->
                Row(
                    modifier = Modifier.padding(start = NameColumnStart, top = 2.dp, end = 16.dp, bottom = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = row.boundFor?.let { stringResource(R.string.frequency_bound_for, it) }.orEmpty(),
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate700,
                    )
                    FrequencyFigure(row)
                }
            }
        }
    }
}

/**
 * "Setiap ~5 menit" with the days it holds on under it, muted, as the caveat on the figure. A
 * corridor that doesn't run on the day shown says when it does run instead, and then the days are
 * the message, so they aren't repeated under it.
 */
@Composable
private fun FrequencyFigure(row: Frequency, modifier: Modifier = Modifier) {
    val qualifier = dayQualifier(row.days)
    val figure = row.headwaySeconds?.let { stringResource(R.string.frequency_every, headwayMinutes(it)) }
        ?: onlyLabel(qualifier)
    Column(modifier = modifier, horizontalAlignment = Alignment.End) {
        Text(
            text = figure,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = Slate700,
            textAlign = TextAlign.End,
            softWrap = false,
        )
        if (row.headwaySeconds != null && qualifier != null) {
            Text(text = qualifierLabel(qualifier), style = MaterialTheme.typography.bodySmall, color = Slate500, softWrap = false)
        }
    }
}

/** The corridor's window, never "bus terakhir": a halte halfway along sees its last bus later. */
@Composable
private fun serviceHoursLabel(hours: ServiceHours?): String? = when (hours) {
    null -> null
    ServiceHours.AllDay -> stringResource(R.string.frequency_all_day)
    is ServiceHours.Window -> stringResource(R.string.frequency_hours, dottedTime(hours.start), dottedTime(hours.end))
}

@Composable
private fun qualifierLabel(qualifier: DayQualifier): String = stringResource(
    when (qualifier) {
        DayQualifier.WEEKDAYS -> R.string.frequency_weekdays
        DayQualifier.WEEKEND -> R.string.frequency_weekend
        DayQualifier.SATURDAY -> R.string.frequency_saturday
        DayQualifier.SUNDAY -> R.string.frequency_sunday
    },
)

@Composable
private fun onlyLabel(qualifier: DayQualifier?): String = stringResource(
    when (qualifier) {
        null -> R.string.frequency_not_running
        DayQualifier.WEEKDAYS -> R.string.frequency_weekdays_only
        DayQualifier.WEEKEND -> R.string.frequency_weekend_only
        DayQualifier.SATURDAY -> R.string.frequency_saturday_only
        DayQualifier.SUNDAY -> R.string.frequency_sunday_only
    },
)

/**
 * An operator that publishes no timetable (TransJakarta). A fact about the operator, not a failure,
 * so it offers no retry.
 */
@Composable
fun NoScheduleNote(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(R.string.station_no_schedule_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = stringResource(R.string.station_no_schedule_message),
            style = MaterialTheme.typography.bodyLarge,
            color = Gray600,
        )
    }
}

private val previewLines = mapOf(
    "TJ:13" to LineInfo("Ciledug - Tegal Mampang", "13", "#5C2D91", "TJ"),
    "TJ:13B" to LineInfo("Puri Beta - Pancoran", "13B", "#5C2D91", "TJ"),
    "TJ:13E" to LineInfo("Puri Beta - Kuningan", "13E", "#5C2D91", "TJ"),
    "TJ:L13E" to LineInfo("Puri Beta - Latuharhary", "L13E", "#5C2D91", "TJ"),
)

/** Petukangan D'MASIV on a weekday, as the API answers. */
@Preview(showBackground = true)
@Composable
private fun FrequencyListPreview() {
    CommutePreviewScaffold {
        FrequencyList(
            frequencies = listOf(
                Frequency("TJ:13", 186.0, boundFor = "Tegal Mampang", serviceHours = ServiceHours.AllDay),
                Frequency("TJ:13", 121.0, boundFor = "Puri Beta 1", serviceHours = ServiceHours.AllDay),
                Frequency("TJ:13B", 300.0, boundFor = "Pancoran Arah Timur", serviceHours = ServiceHours.Window("05:00", "22:00")),
                Frequency("TJ:13B", 240.0, boundFor = "Puri Beta 2", serviceHours = ServiceHours.Window("05:00", "22:00")),
                Frequency("TJ:13E", null, days = setOf(ServiceDayName.SAT, ServiceDayName.SUN)),
                Frequency("TJ:L13E", 120.0, days = setOf(ServiceDayName.WD), serviceHours = ServiceHours.Window("05:00", "22:00")),
            ),
            lines = previewLines,
            modifier = Modifier.padding(16.dp),
        )
    }
}

/** Before the line dictionary lands: bare codes on grey. */
@Preview(showBackground = true)
@Composable
private fun FrequencyListLoadingLinesPreview() {
    CommutePreviewScaffold {
        FrequencyList(
            frequencies = listOf(Frequency("TJ:1", 300.0), Frequency("TJ:9", 420.0, days = setOf(ServiceDayName.SUN))),
            lines = emptyMap(),
            modifier = Modifier.padding(16.dp),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun NoScheduleNotePreview() {
    CommutePreviewScaffold {
        HalteFrequencies(frequencies = emptyList(), lines = emptyMap())
    }
}
