package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.HorizontalAlignmentLine
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.node.Ref
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Slate300
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate900

/*
 * The journey timeline's parts, one set for the trip details and the live trip: a gutter down the
 * left with the line's rail in it, a node on the rail for each stop, and the stop's line beside it.
 * The web's fare timeline grid.
 */

/** The gutter the rail runs down; the rail runs down its middle. */
val TimelineGutter = 28.dp

/** The rail's gauge: the route bar's, laid upright. */
val TimelineLineWidth = 6.dp

/**
 * Where a row's node sits, from the row's content: the middle of a stop name's first line, set by
 * [TimelineStopName]. Of several, the topmost.
 */
private val TimelineAnchor = HorizontalAlignmentLine(::minOf)

/**
 * One row of the timeline: the gutter with its rail, a [node] on it, and the row's content beside it.
 * The node sits level with the first line of the stop's name, so a name that wraps, or has "TURUN"
 * under it, keeps its ring beside the name rather than between the lines; a row without a name puts
 * it on the middle. [top] and [bottom] paint the rail above and below that point, or leave it bare
 * at a line's end.
 */
@Composable
fun TimelineRow(
    top: Brush?,
    bottom: Brush?,
    modifier: Modifier = Modifier,
    node: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Layout(
        contents = listOf(
            content,
            { Box(if (top != null) Modifier.background(top) else Modifier) },
            { Box(if (bottom != null) Modifier.background(bottom) else Modifier) },
            { if (node != null) node() },
        ),
        modifier = modifier.fillMaxWidth(),
    ) { (contentMeasurables, topMeasurables, bottomMeasurables, nodeMeasurables), constraints ->
        val gutter = TimelineGutter.roundToPx()
        val line = TimelineLineWidth.roundToPx()
        val width = constraints.maxWidth
        val contents = contentMeasurables.map { it.measure(Constraints(maxWidth = (width - gutter).coerceAtLeast(0))) }
        val nodes = nodeMeasurables.map { it.measure(Constraints()) }
        val contentHeight = contents.maxOfOrNull { it.height } ?: 0
        val height = maxOf(contentHeight, nodes.maxOfOrNull { it.height } ?: 0, constraints.minHeight)
        val contentY = (height - contentHeight) / 2
        val anchor = contents.firstNotNullOfOrNull { placeable ->
            placeable[TimelineAnchor].takeIf { it != AlignmentLine.Unspecified }
        }
        val center = (anchor?.let { contentY + it } ?: (height / 2)).coerceIn(0, height)
        val railTop = topMeasurables.map { it.measure(Constraints.fixed(line, center)) }
        val railBottom = bottomMeasurables.map { it.measure(Constraints.fixed(line, height - center)) }

        layout(width, height) {
            val railX = (gutter - line) / 2
            railTop.forEach { it.place(railX, 0) }
            railBottom.forEach { it.place(railX, center) }
            nodes.forEach { it.place((gutter - it.width) / 2, center - it.height / 2) }
            contents.forEach { it.place(gutter, contentY) }
        }
    }
}

/**
 * A stop's name in the timeline, which the row's node lines up with: the middle of its first line,
 * however many lines it runs to.
 */
@Composable
fun TimelineStopName(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight? = null,
    color: Color = Color.Unspecified,
) {
    // Set while the text measures, read just after: no recomposition needed, so not state.
    val layoutResult = remember { Ref<TextLayoutResult>() }
    Text(
        text = text,
        modifier = modifier.layout { measurable, constraints ->
            val placeable = measurable.measure(constraints)
            val firstLine = layoutResult.value?.let { (it.getLineTop(0) + it.getLineBottom(0)) / 2 }
            val center = firstLine?.roundToInt() ?: (placeable.height / 2)
            layout(placeable.width, placeable.height, mapOf(TimelineAnchor to center)) { placeable.place(0, 0) }
        },
        style = style,
        fontWeight = fontWeight,
        color = color,
        onTextLayout = { layoutResult.value = it },
    )
}

/** A row the rail runs straight through, one [rail] top to bottom. */
@Composable
fun TimelineRow(rail: Brush?, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    TimelineRow(top = rail, bottom = rail, modifier = modifier, content = content)
}

/** A stop on the rail: a disc of [fill] ringed in [ring]. */
@Composable
fun TimelineNode(size: Dp, fill: Color, ring: Color, ringWidth: Dp = 3.dp) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(fill)
            .border(ringWidth, ring, CircleShape),
    )
}

/** Where a ride starts or ends: the big ring. */
@Composable
fun StationNode(ring: Color, fill: Color = Color.White) {
    TimelineNode(size = 16.dp, fill = fill, ring = ring, ringWidth = 4.dp)
}

/** A stop the ride passes through: the small ring. */
@Composable
fun StopNode(ring: Color, fill: Color = Color.White) {
    TimelineNode(size = 10.dp, fill = fill, ring = ring)
}

/**
 * A stop's line beside the rail: its name (and whatever goes under it) on the left, and [trailing]
 * (its time) on the right. No time, no column: TransJakarta publishes none, and a dash would read as
 * one we failed to fetch.
 */
@Composable
fun TimelineStopLine(
    trailing: (@Composable () -> Unit)? = null,
    padding: Dp = 2.dp,
    content: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = padding)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) { content() }
        if (trailing != null) {
            Box(modifier = Modifier.padding(start = 12.dp)) { trailing() }
        }
    }
}

/** The pink "TURUN" under the stop to get off at, read out as [description]. */
@Composable
fun GetOffBadge(text: String, description: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier
            .padding(top = 2.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp, vertical = 1.dp)
            .clearAndSetSemantics { contentDescription = description },
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onPrimary,
    )
}

/** A vehicle with the swap arrows on it: a change, by train or by bus. The web's `TransferIcon`. */
@Composable
fun TransferIcon(bus: Boolean, modifier: Modifier = Modifier, tint: Color = Slate500) {
    Box(modifier = modifier) {
        Icon(
            imageVector = if (bus) CommuteIcons.Bus else CommuteIcons.Train,
            contentDescription = null,
            modifier = Modifier.fillMaxWidth().fillMaxHeight(),
            tint = tint,
        )
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = 2.dp, y = 1.dp)
                .fillMaxWidth(0.65f)
                .fillMaxHeight(0.65f)
                .clip(CircleShape)
                .background(tint),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = CommuteIcons.Swap,
                contentDescription = null,
                modifier = Modifier.fillMaxWidth(0.8f).fillMaxHeight(0.8f),
                tint = Color.White,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun TimelinePreview() {
    val line = SolidColor(Color(0xFFE30A16))
    CommutePreviewScaffold {
        Column(modifier = Modifier.padding(16.dp)) {
            TimelineRow(top = null, bottom = line, node = { StationNode(Color(0xFFE30A16)) }) {
                TimelineStopLine(trailing = { Text("18.02", color = Slate500) }) {
                    TimelineStopName("Bogor", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            }
            TimelineRow(top = line, bottom = line, node = { StopNode(Color(0xFFE30A16)) }) {
                TimelineStopLine(padding = 6.dp) { TimelineStopName("Cilebut", style = MaterialTheme.typography.bodyMedium, color = Slate900) }
            }
            TimelineRow(top = line, bottom = SolidColor(Slate300), node = { StationNode(Color(0xFFE30A16)) }) {
                TimelineStopLine(trailing = { Text("18.40", color = Slate500) }) {
                    TimelineStopName("Manggarai", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    GetOffBadge(text = "TURUN", description = "Turun di sini")
                }
            }
        }
    }
}
