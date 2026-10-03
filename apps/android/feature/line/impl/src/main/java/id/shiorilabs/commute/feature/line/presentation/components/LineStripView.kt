package id.shiorilabs.commute.feature.line.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.ext.Foreground
import id.shiorilabs.commute.core.ui.ext.foreground
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.ext.tint
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.line.R
import id.shiorilabs.commute.feature.line.domain.LineStop
import id.shiorilabs.commute.feature.line.domain.LineStrip
import id.shiorilabs.commute.feature.line.domain.LoopLayout
import id.shiorilabs.commute.feature.line.domain.LoopRow
import id.shiorilabs.commute.feature.line.domain.NodeKind
import id.shiorilabs.commute.feature.line.domain.RailCap
import id.shiorilabs.commute.feature.line.domain.StripRow
import id.shiorilabs.commute.feature.station.domain.LineInfo

/*
 * The rail vocabulary, the web's transit-geometry.ts: a 6dp bar centred 22dp into a 44dp gutter
 * carrying a station's roundel. The loop's ring lines its sides up with the same centreline.
 */
private val RailWidth = 6.dp
private val RailCenter = 22.dp
private val Gutter = 44.dp
private val NodeSize = RoundelSize.MD

/** The web's `max-w-md`. */
private val StripMaxWidth = 448.dp

/** The loop's U-bend at the bottom, and the curve off the trunk into the closure at the top. */
private val RingRadius = 24.dp
private val JunctionCurve = 16.dp

/** How far above the loop its ring starts: the junction node's centre, a standard row's half. */
private val JunctionRise = 24.dp

/** Text on a node's white face and on a pale fill, the web's `text-slate-900`. */
private val NodeInk = Color(0xFF0F172A)

/** Which side of the loop a station sits on: down the left, or back up the right. */
private enum class LoopSide { LEFT, RIGHT }

/**
 * A line's stations down a rail in its colour, the web's line strip: one row per station, each
 * opening its page, with the operator's other lines that call there as badges opening theirs. A
 * branch not shown inline peels off its junction as a pill that shows it instead; a loop hangs off
 * the end of the trunk as a ring.
 */
@Composable
fun LineStripView(
    strip: LineStrip,
    colorCode: String,
    operator: String,
    lines: Map<String, LineInfo>,
    onOpenStation: (LineStop) -> Unit,
    onOpenLine: (LineInfo) -> Unit,
    onShowBranch: (tailIndex: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val color = parseHexColor(colorCode)
    Column(
        modifier = modifier
            .widthIn(max = StripMaxWidth)
            .fillMaxWidth(),
    ) {
        strip.rows.forEach { row ->
            when (row) {
                is StripRow.Stop -> StationRow(
                    stop = row,
                    colorCode = colorCode,
                    operator = operator,
                    lines = lines,
                    onClick = { onOpenStation(row.station) },
                    onOpenLine = onOpenLine,
                    // Over the loop's ring, which rises into the junction's row behind its node.
                    modifier = Modifier.zIndex(1f),
                )

                is StripRow.Ramp -> BranchRamp(
                    terminusName = row.terminusName,
                    color = color,
                    onClick = { onShowBranch(row.tailIndex) },
                    modifier = Modifier.zIndex(1f),
                )
            }
        }
        strip.loop?.let { loop ->
            LoopSection(
                loop = loop,
                colorCode = colorCode,
                operator = operator,
                lines = lines,
                onOpenStation = onOpenStation,
                onOpenLine = onOpenLine,
            )
        }
    }
}

/**
 * One station on the single rail: its node on the rail, its name and badges beside it. The rail
 * stops at the node on the strip's first and last rows.
 */
@Composable
private fun StationRow(
    stop: StripRow.Stop,
    colorCode: String,
    operator: String,
    lines: Map<String, LineInfo>,
    onClick: () -> Unit,
    onOpenLine: (LineInfo) -> Unit,
    modifier: Modifier = Modifier,
) {
    val color = parseHexColor(colorCode)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                val top = if (stop.railCap == RailCap.START) size.height / 2 else 0f
                val bottom = if (stop.railCap == RailCap.END) size.height / 2 else size.height
                drawRect(
                    color = color,
                    topLeft = Offset((RailCenter - RailWidth / 2).toPx(), top),
                    size = Size(RailWidth.toPx(), bottom - top),
                )
            }
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = stop.station.name },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(Gutter), contentAlignment = Alignment.Center) {
            StationNode(stop.kind, colorCode, stop.station.stationNumber, operator)
        }
        StopContent(
            station = stop.station,
            kind = stop.kind,
            lines = lines,
            compact = false,
            alignEnd = false,
            onOpenLine = onOpenLine,
            // pl-3: a wide number's node reaches past the gutter, so the name keeps clear of it.
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp, top = 12.dp, bottom = 12.dp),
        )
    }
}

/**
 * The station's roundel riding the rail: its number stacked as the line's prefix over its position,
 * as the FDTJ map prints them. Filled with the line's colour at the strip's anchors (termini,
 * junctions) and ringed elsewhere, whatever the operator, so the anchors read at a glance; raised
 * off the rail where something happens (an anchor, an interchange).
 *
 * The web draws its own node here; the app uses the roundel, so a station number looks the same
 * wherever it is shown.
 */
@Composable
private fun StationNode(
    kind: NodeKind,
    colorCode: String,
    stationNumber: String,
    operator: String,
    modifier: Modifier = Modifier,
) {
    val filled = kind == NodeKind.TERMINUS || kind == NodeKind.JUNCTION
    val raised = filled || kind == NodeKind.INTERCHANGE
    LineRoundel(
        code = stationNumber,
        color = colorCode,
        operator = operator,
        size = NodeSize,
        station = true,
        filled = filled,
        modifier = modifier.then(if (raised) Modifier.shadow(1.dp, CircleShape) else Modifier),
    )
}

/** A station's name, bold at an interchange or junction, over its other lines' badges. */
@Composable
private fun StopContent(
    station: LineStop,
    kind: NodeKind,
    lines: Map<String, LineInfo>,
    compact: Boolean,
    alignEnd: Boolean,
    onOpenLine: (LineInfo) -> Unit,
    modifier: Modifier = Modifier,
) {
    val horizontal = if (alignEnd) Alignment.End else Alignment.Start
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = horizontal,
    ) {
        Text(
            text = station.name,
            fontSize = if (compact) 14.sp else 16.sp,
            lineHeight = if (compact) 20.sp else 24.sp,
            fontWeight = if (kind == NodeKind.INTERCHANGE || kind == NodeKind.JUNCTION) {
                FontWeight.Bold
            } else {
                FontWeight.SemiBold
            },
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = if (alignEnd) TextAlign.End else TextAlign.Start,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        // Until the dictionary loads there is nothing to draw a badge with.
        val others = station.otherLines.mapNotNull { lines[it] }
        if (others.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(4.dp, horizontal),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                others.forEach { line -> LineBadge(line, compact, onClick = { onOpenLine(line) }) }
            }
        }
    }
}

/** Another line that calls here, as a pill in its colour: its name, or its code in the loop. */
@Composable
private fun LineBadge(line: LineInfo, compact: Boolean, onClick: () -> Unit) {
    val color = parseHexColor(line.colorCode)
    val description = stringResource(R.string.line_badge_description, line.name)
    Text(
        text = if (compact) line.lineCode else line.name.replace("Lin ", ""),
        modifier = Modifier
            .background(color, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description }
            .padding(horizontal = if (compact) 6.dp else 10.dp),
        fontSize = if (compact) 10.sp else 14.sp,
        lineHeight = if (compact) 16.sp else 20.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (color.foreground() == Foreground.LIGHT) Color.White else NodeInk,
    )
}

/**
 * A branch not shown inline: the rail carries on behind it while a quarter-turn peels off into an
 * "arah {terminus}" pill. Tapping it shows that branch inline, and the one shown until now peels
 * off here instead.
 */
@Composable
private fun BranchRamp(
    terminusName: String,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val description = stringResource(R.string.line_branch_description, terminusName)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                val rail = RailWidth.toPx()
                val center = RailCenter.toPx()
                drawRect(color, Offset(center - rail / 2, 0f), Size(rail, size.height))
                // The web's 44×28 box with a rounded bottom-left border, 2dp above the pill's row:
                // its centreline runs down the rail, then turns into the pill's middle.
                val bottom = (26.dp - RailWidth / 2).toPx()
                val radius = (JunctionCurve - RailWidth / 2).toPx()
                val curve = Path().apply {
                    moveTo(center, (-2).dp.toPx())
                    lineTo(center, bottom - radius)
                    arcTo(
                        rect = Rect(Offset(center + radius, bottom - radius), radius),
                        startAngleDegrees = 180f,
                        sweepAngleDegrees = -90f,
                        forceMoveTo = false,
                    )
                    lineTo((Gutter + 19.dp).toPx(), bottom)
                }
                drawPath(curve, color, style = Stroke(width = rail))
            },
    ) {
        Spacer(Modifier.width(Gutter))
        Row(
            modifier = Modifier
                .padding(start = 12.dp, top = 4.dp, bottom = 4.dp)
                .background(color.tint(0.15f), CircleShape)
                .clickable(role = Role.Button, onClick = onClick)
                .semantics(mergeDescendants = true) { contentDescription = description }
                .padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = CommuteIcons.Branch,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = NodeInk,
            )
            Text(
                text = stringResource(R.string.line_branch, terminusName),
                fontSize = 14.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.Bold,
                color = NodeInk,
            )
        }
    }
}

/**
 * The loop folded into two columns inside one ring: down the left, round the bottom and back up
 * the right, then across the top and up into the junction above. The ring is one stroke, drawn
 * under the junction's row so its node covers where the two meet.
 */
@Composable
private fun LoopSection(
    loop: LoopLayout,
    colorCode: String,
    operator: String,
    lines: Map<String, LineInfo>,
    onOpenStation: (LineStop) -> Unit,
    onOpenLine: (LineInfo) -> Unit,
    modifier: Modifier = Modifier,
) {
    val color = parseHexColor(colorCode)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind { drawPath(ringPath(size), color, style = Stroke(width = RailWidth.toPx())) }
            // Each column sits just inside the ring's side, which its nodes ride.
            .padding(horizontal = RailCenter + RailWidth / 2, vertical = 20.dp),
    ) {
        loop.rows.forEach { row ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                LoopCell(
                    station = row.left,
                    side = LoopSide.LEFT,
                    colorCode = colorCode,
                    operator = operator,
                    lines = lines,
                    onClick = { onOpenStation(row.left) },
                    onOpenLine = onOpenLine,
                    modifier = Modifier.weight(1f),
                )
                Box(Modifier.weight(1f)) {
                    row.right?.let { right ->
                        LoopCell(
                            station = right,
                            side = LoopSide.RIGHT,
                            colorCode = colorCode,
                            operator = operator,
                            lines = lines,
                            onClick = { onOpenStation(right) },
                            onOpenLine = onOpenLine,
                        )
                    }
                }
            }
        }
    }
}

/** A loop station: compact, its node pinned onto the ring's side just outside the cell. */
@Composable
private fun LoopCell(
    station: LineStop,
    side: LoopSide,
    colorCode: String,
    operator: String,
    lines: Map<String, LineInfo>,
    onClick: () -> Unit,
    onOpenLine: (LineInfo) -> Unit,
    modifier: Modifier = Modifier,
) {
    val kind = if (station.isInterchange) NodeKind.INTERCHANGE else NodeKind.REGULAR
    val left = side == LoopSide.LEFT
    // The node's centre sits on the ring's centreline, half a rail outside the cell's edge.
    val nodeShift = RailWidth / 2 + NodeSize.diameter / 2
    // The name keeps the same clearance from the node as on the web.
    val contentInset = nodeShift + 9.dp
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = station.name },
    ) {
        StopContent(
            station = station,
            kind = kind,
            lines = lines,
            compact = true,
            alignEnd = !left,
            onOpenLine = onOpenLine,
            // Wider on the ring's side: the node straddles it and reaches into the cell.
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    start = if (left) contentInset else 4.dp,
                    end = if (left) 4.dp else contentInset,
                    top = 8.dp,
                    bottom = 8.dp,
                ),
        )
        StationNode(
            kind = kind,
            colorCode = colorCode,
            stationNumber = station.stationNumber,
            operator = operator,
            modifier = Modifier
                .align(if (left) Alignment.CenterStart else Alignment.CenterEnd)
                .offset(x = if (left) -nodeShift else nodeShift),
        )
    }
}

/**
 * The ring as one path, so it has no joints to come apart: from the junction's node down the left
 * side, round the bottom, up the right, back along the top, and curving up into the left side.
 */
private fun DrawScope.ringPath(size: Size): Path {
    val half = RailWidth.toPx() / 2
    val lx = RailCenter.toPx()
    val rx = size.width - RailCenter.toPx()
    val by = size.height - half
    val ty = half
    val r = RingRadius.toPx() - half
    val jr = JunctionCurve.toPx() - half
    return Path().apply {
        moveTo(lx, -JunctionRise.toPx())
        lineTo(lx, by - r)
        arcTo(Rect(Offset(lx + r, by - r), r), startAngleDegrees = 180f, sweepAngleDegrees = -90f, forceMoveTo = false)
        lineTo(rx - r, by)
        arcTo(Rect(Offset(rx - r, by - r), r), startAngleDegrees = 90f, sweepAngleDegrees = -90f, forceMoveTo = false)
        lineTo(rx, ty + r)
        arcTo(Rect(Offset(rx - r, ty + r), r), startAngleDegrees = 0f, sweepAngleDegrees = -90f, forceMoveTo = false)
        lineTo(lx + jr, ty)
        arcTo(Rect(Offset(lx + jr, ty - jr), jr), startAngleDegrees = 90f, sweepAngleDegrees = 90f, forceMoveTo = false)
    }
}


private fun previewStop(code: String, name: String, number: String, others: List<String> = emptyList()) =
    LineStop("KCI-$code", code, name, number, others.isNotEmpty(), others)

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun LineStripLoopPreview() {
    CommutePreviewScaffold {
        LineStripView(
            strip = LineStrip(
                rows = listOf(
                    StripRow.Stop(previewStop("CKR", "Cikarang", "C01"), NodeKind.TERMINUS, RailCap.START),
                    StripRow.Stop(previewStop("BKS", "Bekasi", "C05"), NodeKind.REGULAR),
                    StripRow.Stop(previewStop("JNG", "Jatinegara", "C12", listOf("KCI:B")), NodeKind.JUNCTION, RailCap.END),
                ),
                loop = LoopLayout(
                    listOf(
                        LoopRow(
                            previewStop("POK", "Pondok Jati", "C13"),
                            previewStop("MTR", "Matraman", "C26"),
                        ),
                        LoopRow(
                            previewStop("MRI", "Manggarai", "C14", listOf("KCI:B")),
                            previewStop("SUD", "Sudirman", "C25"),
                        ),
                    ),
                ),
            ),
            colorCode = "#25B8EB",
            operator = "KCI",
            lines = mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")),
            onOpenStation = {},
            onOpenLine = {},
            onShowBranch = {},
            modifier = Modifier.padding(16.dp),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LineStripBranchPreview() {
    CommutePreviewScaffold {
        LineStripView(
            strip = LineStrip(
                rows = listOf(
                    StripRow.Stop(previewStop("JAKK", "Jakarta Kota", "B01"), NodeKind.TERMINUS, RailCap.START),
                    StripRow.Stop(previewStop("CTA", "Citayam", "B21"), NodeKind.JUNCTION),
                    StripRow.Ramp(tailIndex = 1, terminusName = "Nambo"),
                    StripRow.Stop(previewStop("BOO", "Bogor", "B24"), NodeKind.TERMINUS, RailCap.END),
                ),
            ),
            colorCode = "#EE3D43",
            operator = "KCI",
            lines = emptyMap(),
            onOpenStation = {},
            onOpenLine = {},
            onShowBranch = {},
            modifier = Modifier.padding(16.dp),
        )
    }
}
