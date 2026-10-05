package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.components.HorizontalSpacer
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.SectionLabel
import id.shiorilabs.commute.core.ui.ext.rowEntrance
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Pink800
import id.shiorilabs.commute.core.ui.theme.Rose100
import id.shiorilabs.commute.core.ui.theme.Rose50
import id.shiorilabs.commute.core.ui.theme.Slate400
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.presentation.NearbyPicks
import id.shiorilabs.commute.feature.journey.presentation.PickerUiState
import id.shiorilabs.commute.core.location.LocationPermissions
import id.shiorilabs.commute.core.location.rememberLocationPermissionRequest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay

/** The query the picker starts matching at; below it, the quick picks show. */
private const val MIN_QUERY_LENGTH = 2

/** Waits out the sheet's slide before raising the keyboard, as the web waits 350 ms. */
private const val FOCUS_DELAY_MILLIS = 350L

/** `bg-stone-100/80` and `border-stone-200/40`, the search field's fill and outline. */
private val FieldFill = Color(0xCCF5F5F4)
private val FieldOutline = Color(0x66E7E5E4)

/**
 * Choosing one end of the trip: a full-height sheet with a search field, the rider's recent and the
 * most-picked stations as quick picks, and every station ranked against what they type. The web's
 * `StationPickerDialog`.
 */
@Composable
internal fun StationPickerSheet(
    end: PairEnd,
    picker: PickerUiState,
    /** What the field shows: the typed text, never the ranked query, which arrives late. */
    text: String,
    selectedId: String?,
    onQueryChange: (String) -> Unit,
    onPick: (PickableStation) -> Unit,
    onDismiss: () -> Unit,
    onUseLocation: () -> Unit = {},
) {
    CommuteBottomSheet(
        title = stringResource(if (end == PairEnd.ORIGIN) R.string.journey_picker_from else R.string.journey_picker_to),
        closeDescription = stringResource(R.string.journey_picker_close),
        onDismiss = onDismiss,
        fullHeight = true,
    ) { hide ->
        val focusRequester = remember { FocusRequester() }
        LaunchedEffect(focusRequester) {
            delay(FOCUS_DELAY_MILLIS)
            focusRequester.requestFocus()
        }
        val haptics = LocalHapticFeedback.current
        val pick: (PickableStation) -> Unit = { station ->
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            onPick(station)
            hide()
        }

        PickerField(
            query = text,
            onQueryChange = onQueryChange,
            modifier = Modifier
                .padding(horizontal = 32.dp)
                .focusRequester(focusRequester),
        )

        // Each query's results start at the top. The list otherwise holds on to its first visible
        // row by key, and failing that its index: scrolled into the popular stations before typing,
        // "sudirman" opened on its second result, BNI City, with Sudirman above, out of sight.
        val listState = rememberLazyListState()
        LaunchedEffect(picker.query) {
            listState.scrollToItem(0)
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 8.dp),
            contentPadding = WindowInsets.ime.union(WindowInsets.navigationBars).asPaddingValues(),
        ) {
            // Turned off in Pengaturan → Lokasi, the row isn't offered at all.
            if (text.length < MIN_QUERY_LENGTH && picker.nearby != NearbyPicks.Off) {
                item(key = "use-location") {
                    UseLocation(nearby = picker.nearby, onUseLocation = onUseLocation)
                }
                (picker.nearby as? NearbyPicks.Found)?.stations?.let { nearby ->
                    itemsIndexed(nearby, key = { _, it -> "nearby:${it.first.id}" }) { index, (station, distanceM) ->
                        StationRow(
                            station = station,
                            query = "",
                            selected = station.id == selectedId,
                            onClick = { pick(station) },
                            distanceM = distanceM,
                            modifier = Modifier.rowEntrance(index),
                        )
                    }
                }
            }
            if (text.length < MIN_QUERY_LENGTH && picker.quickPicks.isNotEmpty()) {
                item(key = "quick-picks") {
                    QuickPicks(stations = picker.quickPicks, onPick = pick)
                }
            }
            val highlight = if (picker.query.length >= MIN_QUERY_LENGTH) picker.query else ""
            itemsIndexed(picker.stations, key = { _, it -> it.id }) { index, station ->
                StationRow(
                    station = station,
                    query = highlight,
                    selected = station.id == selectedId,
                    onClick = { pick(station) },
                    modifier = Modifier.rowEntrance(index),
                )
            }
            if (picker.loaded && picker.stations.isEmpty()) {
                item(key = "not-found") {
                    Text(
                        text = stringResource(R.string.journey_picker_not_found),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 32.dp, vertical = 40.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        color = Slate400,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        }
    }
}

@Composable
private fun PickerField(query: String, onQueryChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val description = stringResource(R.string.journey_picker_field_description)
    val textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onBackground)
    BasicTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier
            .fillMaxWidth()
            .semantics { contentDescription = description },
        textStyle = textStyle,
        singleLine = true,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        decorationBox = { inner ->
            Row(
                modifier = Modifier
                    .background(FieldFill, MaterialTheme.shapes.medium)
                    .border(2.dp, FieldOutline, MaterialTheme.shapes.medium)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(imageVector = CommuteIcons.Search, contentDescription = null, modifier = Modifier.size(20.dp), tint = Slate400)
                HorizontalSpacer(10.dp)
                Box(modifier = Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text(text = stringResource(R.string.journey_picker_placeholder), style = textStyle, color = Slate400)
                    }
                    inner()
                }
            }
        },
    )
}

/**
 * "Pakai lokasi kamu": the stations around the rider, on a tap. Location is asked for here, in
 * context, and only once tapped; a refusal leaves a note rather than a dead row.
 */
@Composable
private fun UseLocation(nearby: NearbyPicks, onUseLocation: () -> Unit) {
    val context = LocalContext.current
    val ask = rememberLocationPermissionRequest { granted -> if (granted) onUseLocation() }
    val note = when (nearby) {
        NearbyPicks.Locating -> stringResource(R.string.journey_picker_locating)
        NearbyPicks.NoneNearby -> stringResource(R.string.journey_picker_none_nearby)
        NearbyPicks.Unavailable -> stringResource(R.string.journey_picker_location_unavailable)
        else -> null
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, enabled = nearby != NearbyPicks.Locating) {
                val granted = LocationPermissions.any {
                    ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
                }
                if (granted) onUseLocation() else ask()
            }
            .padding(horizontal = 32.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = CommuteIcons.NavigationArrow,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.journey_picker_use_location),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            note?.let { Text(text = it, style = MaterialTheme.typography.bodySmall, color = Slate500) }
        }
    }
}

/** `350 m`, or `1,2 km` past a kilometre, the Indonesian way. */
private fun formatDistance(metres: Int): String =
    if (metres < 1000) "$metres m" else "%.1f km".format(java.util.Locale.forLanguageTag("id"), metres / 1000.0)

@Composable
private fun QuickPicks(stations: List<PickableStation>, onPick: (PickableStation) -> Unit) {
    Column {
        SectionLabel(
            text = stringResource(R.string.journey_picker_quick_picks),
            modifier = Modifier.padding(start = 32.dp, top = 4.dp, end = 32.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(start = 32.dp, top = 8.dp, end = 32.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(stations, key = { it.id }) { station ->
                Row(
                    modifier = Modifier
                        .background(Rose100, CircleShape)
                        .clickable(role = Role.Button) { onPick(station) }
                        .padding(start = 8.dp, top = 6.dp, end = 14.dp, bottom = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (station.lines.isNotEmpty()) {
                        Row {
                            station.lines.forEachIndexed { index, line ->
                                LineRoundel(
                                    code = line.lineCode,
                                    color = line.colorCode,
                                    operator = station.operator,
                                    size = RoundelSize.SM,
                                    modifier = Modifier.offset(x = (-6).dp * index),
                                )
                            }
                        }
                    }
                    Text(
                        text = station.name,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Pink800,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StationRow(
    station: PickableStation,
    query: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** How far it is, for a station offered as near the rider. */
    distanceM: Int? = null,
) {
    val highlight = MaterialTheme.colorScheme.primary
    val title = remember(station.name, query, highlight) { station.name.highlightMatch(query, highlight) }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(if (selected) Rose50 else Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 32.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(title) }
                    append("  ")
                    withStyle(SpanStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Slate500)) {
                        append(OPERATOR_NAMES[station.operator] ?: station.operator)
                        distanceM?.let { append(" · " + formatDistance(it)) }
                    }
                },
                style = MaterialTheme.typography.titleMedium,
            )
            if (station.lines.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    station.lines.forEach { line ->
                        LineRoundel(code = line.lineCode, color = line.colorCode, operator = station.operator, size = RoundelSize.SM)
                    }
                }
            }
        }
        if (selected) {
            Icon(
                imageVector = CommuteIcons.Selected,
                contentDescription = stringResource(R.string.journey_picker_selected),
                modifier = Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/** This text with the first occurrence of [query] in [color], as search's results show it. */
private fun String.highlightMatch(query: String, color: Color): AnnotatedString {
    val start = if (query.isEmpty()) -1 else indexOf(query, ignoreCase = true)
    if (start < 0) {
        return AnnotatedString(this)
    }
    return buildAnnotatedString {
        append(this@highlightMatch)
        addStyle(SpanStyle(color = color), start, start + query.length)
    }
}
