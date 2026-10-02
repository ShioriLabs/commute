package id.shiorilabs.commute.feature.station.presentation.timetable

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.time.minuteOfDay
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import id.shiorilabs.commute.feature.station.domain.directionalBaseName
import id.shiorilabs.commute.feature.station.domain.formatClock
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.station.domain.joinLabels

// Tailwind's colours, as the web's timetable page uses them.
private val Slate100 = Color(0xFFF1F5F9)
private val Slate400 = Color(0xFF94A3B8)
private val Slate500 = Color(0xFF64748B)
private val Slate700 = Color(0xFF334155)
private val Slate900 = Color(0xFF0F172A)
private val Gray600 = Color(0xFF4B5563)

/** The page is white, as the station page it opens from. */
private val TimetableBackground = Color.White

private const val DAY_MINUTES = 1440

/**
 * A station's whole timetable for the day, the web's "Jadwal Lengkap": every departure, a section
 * per line and direction under a sticky header, the next one in each picked out in its line's
 * colour, and a filter to hide lines. It opens scrolled to the soonest departure of all.
 *
 * [placeholderTitle] is the station's name as the page it opened from showed it, for the header to
 * stand on until the station loads.
 */
@Composable
fun StationTimetableScreen(
    stationId: String,
    innerPadding: PaddingValues,
    placeholderTitle: String? = null,
    viewModel: StationTimetableViewModel = hiltViewModel<StationTimetableViewModel, StationTimetableViewModel.Factory>(
        creationCallback = { factory -> factory.create(stationId) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val now = rememberJakartaNow()

    StationTimetableContent(
        state = state,
        nowMinute = minuteOfDay(now),
        innerPadding = innerPadding,
        placeholderTitle = placeholderTitle,
        onClose = { navigator.pop() },
        onToggleLine = viewModel::onToggleLine,
        onRetry = viewModel::retry,
    )
}

@Composable
private fun StationTimetableContent(
    state: StationTimetableUiState,
    nowMinute: Int,
    innerPadding: PaddingValues,
    placeholderTitle: String? = null,
    onClose: () -> Unit = {},
    onToggleLine: (String) -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TimetableBackground),
    ) {
        TimetableHeader(
            title = (state.title ?: placeholderTitle)?.let(::directionalBaseName),
            onClose = onClose,
            modifier = Modifier.padding(top = innerPadding.calculateTopPadding()),
        )
        when (val sections = state.sections) {
            is UIState.Idle, is UIState.Loading -> SkeletonBlock(
                modifier = Modifier
                    .padding(start = 16.dp, top = 8.dp, end = 16.dp)
                    .fillMaxWidth()
                    .height(288.dp),
            )

            is UIState.Error -> ProblemPanel(
                message = stringResource(
                    if (sections.cause?.toFailure() is Failure.Network) {
                        R.string.station_timetable_offline
                    } else {
                        R.string.station_timetable_failed
                    },
                ),
                retryLabel = stringResource(R.string.station_retry),
                onRetry = onRetry,
                modifier = Modifier.padding(16.dp),
            )

            is UIState.Success -> if (sections.data.isEmpty()) {
                ProblemPanel(
                    message = stringResource(R.string.station_timetable_empty),
                    retryLabel = stringResource(R.string.station_retry),
                    onRetry = onRetry,
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LineFilter(
                    lineKeys = state.lineKeys,
                    lines = state.lines,
                    excluded = state.excluded,
                    onToggle = onToggleLine,
                    modifier = Modifier.padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 8.dp),
                )
                TimetableList(
                    sections = state.visibleSections,
                    lines = state.lines,
                    nowMinute = nowMinute,
                    bottomInset = innerPadding.calculateBottomPadding(),
                )
            }
        }
    }
}

/** The station's name over "Jadwal Lengkap", with the close button beside it, as on the web. */
@Composable
private fun TimetableHeader(
    title: String?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            // The web's p-8 pb-4.
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            if (title != null) {
                Text(
                    text = title,
                    modifier = Modifier.semantics { heading() },
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = stringResource(R.string.station_timetable_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Gray600,
                )
            } else {
                SkeletonBlock(
                    modifier = Modifier
                        .width(256.dp)
                        .height(24.dp),
                    shape = MaterialTheme.shapes.small,
                )
            }
        }
        CommuteIconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
            Icon(
                imageVector = CommuteIcons.Close,
                contentDescription = stringResource(R.string.station_timetable_close_description),
                modifier = Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
}

/**
 * "Filter Jalur": a chip that opens the station's lines, each switched on or off by a tap. A line
 * switched off shows dimmed and struck through, and the chip counts the lines still shown.
 */
@Composable
private fun LineFilter(
    lineKeys: List<String>,
    lines: Map<String, LineInfo>,
    excluded: Set<String>,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box(modifier = modifier) {
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .background(Slate100)
                .clickable(role = Role.Button) { open = true }
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.station_timetable_filter),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = Slate700,
            )
            if (excluded.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.station_timetable_filter_count, lineKeys.size - excluded.size, lineKeys.size),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Icon(
                imageVector = CommuteIcons.MoveDown,
                contentDescription = null,
                modifier = Modifier.size(12.dp),
                tint = Slate700,
            )
        }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = TimetableBackground,
        ) {
            lineKeys.forEach { key ->
                val info = lines[key]
                val active = key !in excluded
                DropdownMenuItem(
                    text = {
                        Text(
                            text = info?.name ?: codeOfLineKey(key),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (active) Slate900 else Slate400,
                            textDecoration = if (active) null else TextDecoration.LineThrough,
                        )
                    },
                    leadingIcon = {
                        LineRoundel(
                            code = info?.lineCode ?: codeOfLineKey(key),
                            color = info?.colorCode ?: "#94A3B8",
                            operator = info?.operator,
                            modifier = Modifier.alpha(if (active) 1f else 0.4f),
                        )
                    },
                    onClick = { onToggle(key) },
                )
            }
        }
    }
}

/**
 * The sections, a sticky header each over its departures. On first showing, the soonest departure
 * of all is scrolled to the middle of the screen.
 */
@Composable
private fun TimetableList(
    sections: List<TimetableSection>,
    lines: Map<String, LineInfo>,
    nowMinute: Int,
    bottomInset: Dp,
) {
    val listState = rememberLazyListState()
    // Each section's next departure, re-picked as the clock ticks.
    val nearest = remember(sections, nowMinute) { sections.associate { it.key to nearestIndex(it, nowMinute) } }

    if (sections.isEmpty()) {
        Text(
            text = stringResource(R.string.station_timetable_filtered_empty),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, top = 32.dp, end = 16.dp),
            style = MaterialTheme.typography.bodyLarge,
            color = Gray600,
            textAlign = TextAlign.Center,
        )
        return
    }

    ScrollToSoonest(listState, sections, nearest, nowMinute)

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = bottomInset + 32.dp),
    ) {
        sections.forEach { section ->
            val info = lines[section.lineKey]
            val lineColor = info?.colorCode?.let { parseHexColor(it) } ?: Slate400
            val nearestIndex = nearest[section.key] ?: -1
            stickyHeader(key = "header:${section.key}") {
                SectionHeader(section, info, lineColor)
            }
            section.rows.forEachIndexed { index, row ->
                item(key = "row:${section.key}:${row.tripNumber ?: index}:${row.minute}") {
                    DepartureRow(row = row, isNearest = index == nearestIndex, lineColor = lineColor)
                }
            }
        }
    }
}

/**
 * Scrolls once, when the list first lays out, so the soonest upcoming departure across every
 * section sits mid-screen, as the web does on open.
 */
@Composable
private fun ScrollToSoonest(
    listState: LazyListState,
    sections: List<TimetableSection>,
    nearest: Map<String, Int>,
    nowMinute: Int,
) {
    var scrolled by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (scrolled) {
            return@LaunchedEffect
        }
        scrolled = true
        var itemIndex = 0
        var target: Int? = null
        var soonest = Int.MAX_VALUE
        sections.forEach { section ->
            val rowIndex = nearest[section.key] ?: -1
            if (rowIndex >= 0) {
                // Minutes until it leaves, counting one that left a minute ago as about to.
                val until = (section.rows[rowIndex].minute - (nowMinute - 1) + DAY_MINUTES) % DAY_MINUTES
                if (until < soonest) {
                    soonest = until
                    target = itemIndex + 1 + rowIndex
                }
            }
            itemIndex += 1 + section.rows.size
        }
        val index = target ?: return@LaunchedEffect
        listState.scrollToItem(index)
        val layout = listState.layoutInfo
        val item = layout.visibleItemsInfo.firstOrNull { it.index == index } ?: return@LaunchedEffect
        val viewport = layout.viewportEndOffset - layout.viewportStartOffset
        listState.scrollBy(-(viewport / 2f - item.size / 2f))
    }
}

/** A section's sticky header: the line's roundel, where it heads, and its platform. */
@Composable
private fun SectionHeader(
    section: TimetableSection,
    info: LineInfo?,
    lineColor: Color,
) {
    Column(modifier = Modifier.background(TimetableBackground.copy(alpha = 0.95f))) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineRoundel(
                code = info?.lineCode ?: codeOfLineKey(section.lineKey),
                color = info?.colorCode ?: "#94A3B8",
                operator = info?.operator,
            )
            Text(
                text = stringResource(R.string.station_timetable_towards, joinLabels(section.label)),
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = Slate900,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            section.platformCode?.let { platform ->
                Text(
                    text = stringResource(R.string.station_timetable_platform, formatPlatformCode(platform)),
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        // The web's line colour at 20%.
                        .background(lineColor.copy(alpha = 0.2f))
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = Slate900,
                )
            }
        }
        HorizontalDivider(color = Slate100)
    }
}

/** One departure: where it goes, and when. The next one in its section is bold in the line's colour. */
@Composable
private fun DepartureRow(
    row: TimetableRow,
    isNearest: Boolean,
    lineColor: Color,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = row.boundFor,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (isNearest) FontWeight.Bold else FontWeight.SemiBold,
                    color = Slate900,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                row.via?.let { via ->
                    Text(
                        text = stringResource(R.string.station_via, via),
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Text(
                text = formatClock(row.minute),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (isNearest) FontWeight.Bold else FontWeight.SemiBold,
                color = if (isNearest) lineColor else Slate700,
            )
        }
        HorizontalDivider(color = Slate100)
    }
}

@Preview(showBackground = true)
@Composable
private fun StationTimetableContentPreview() {
    val section = TimetableSection(
        key = "KCI:B:south",
        lineKey = "KCI:B",
        label = listOf("Depok", "Bogor"),
        platformCode = "3/4",
        rows = (5 * 60..9 * 60 step 20).map { TimetableRow(null, "Bogor", null, it) },
        serviceStart = 5 * 60,
    )
    CommutePreviewScaffold {
        StationTimetableContent(
            state = StationTimetableUiState(
                title = "Manggarai",
                sections = UIState.Success(listOf(section)),
                lines = mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")),
                lineKeys = listOf("KCI:B"),
                excluded = emptySet(),
            ),
            nowMinute = 7 * 60,
            innerPadding = PaddingValues(),
        )
    }
}
