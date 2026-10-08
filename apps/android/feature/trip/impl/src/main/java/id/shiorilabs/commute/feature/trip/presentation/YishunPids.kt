package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.ext.lineColorOf
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.R
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.tan

/** SMRT's panel: a deep navy, a touch bluer than the JR board's ink. */
private val YishunInk = Color(0xFF0F1B2D)
private val YishunMuted = Color(0xFF9FB0C8)

/** The line behind the rider, and its stops: SMRT greys out what's been passed. */
private val YishunPassed = Color(0xFF3A4A62)
private val YishunPassedText = Color(0xFF6B7A92)

/** "Turun", the stop to get off at. */
private val YishunAlight = Color(0xFFE8455F)

/** The light band laid across the stop the big name is about. */
private val YishunBand = Color(0x24FFFFFF)

/** Names lean up to the right at this angle, as on SMRT's strip. */
private const val NAME_ANGLE_DEG = 50f

/** The strip's line, this far down it; the names rise from it, the roundels and "Turun" hang under. */
private val LineY = 150.dp
private val StripHeight = 214.dp
private val LineThickness = 6.dp
private val PillHeight = 20.dp
private val PillMinWidth = 30.dp
private val SlotWidth = 44.dp
private val StripStart = 16.dp

/** Room past the last pill for its name to lean into. */
private val StripEnd = 28.dp
private val NameGap = 6.dp
private const val TRANSFER_ROUNDELS = 2

/** Room under a pill for "Turun" and the roundels, wider than the pill's own slot. */
private val TagWidth = 72.dp

/** Where a stop's name rises from, for its pill centred at [x]: just above the pill's left edge. */
private fun nameStartOf(x: Dp): Dp = x - PillMinWidth / 2 + 4.dp

/** Figures of one width, so minutes don't shift as they tick. */
private const val TABULAR = "tnum"

/**
 * [PidsStyle.Yishun]'s in-train display, after SMRT's strip map: the big name, then the ride across
 * the width as a straight line, stops on it as pills (minutes ahead, grey behind), their names
 * leaning up to the right, a light band on the one the big name is about. A long ride's middle is
 * left out: "+N" stands for it, then the stop to get off at. Nothing on it moves; it just redraws as
 * the ride goes.
 */
@Composable
internal fun YishunBoard(
    pids: Pids,
    strip: YishunStrip?,
    lines: Map<String, LineInfo>,
    /** Every station's lines, keyed by station id, for the roundels under each stop. */
    stationLines: Map<String, List<String>>,
    copy: TripCopy,
    source: String?,
    onNameMoved: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(YishunInk)
            .padding(bottom = 14.dp),
    ) {
        Column(modifier = Modifier.padding(start = 20.dp, top = 12.dp, end = 20.dp)) {
            Text(
                text = stringResource(pids.label.text),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = YishunMuted,
            )
            StationName(
                pids.station,
                modifier = Modifier
                    .padding(top = 2.dp)
                    .onGloballyPositioned { onNameMoved(it.positionInRoot().y + it.size.height) },
            )
        }
        if (strip != null && strip.stops.isNotEmpty()) {
            Strip(strip, pids, lines, stationLines)
        }
        pids.changeTo?.let { then ->
            Text(
                text = stringResource(R.string.trip_then_change, copy.rideName(then)),
                modifier = Modifier.padding(start = 20.dp, top = 4.dp, end = 20.dp),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
        source?.let {
            Text(
                text = it,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, top = 6.dp, end = 20.dp),
                style = MaterialTheme.typography.labelSmall,
                color = YishunPassedText,
                textAlign = TextAlign.End,
            )
        }
    }
}

/** One place along the strip: a stop, or the gap standing for the stops left out. */
private sealed interface Slot {
    data class Stop(val stop: YishunStop) : Slot
    data class Gap(val skipped: Int) : Slot
}

@Composable
private fun Strip(strip: YishunStrip, pids: Pids, lines: Map<String, LineInfo>, stationLines: Map<String, List<String>>) {
    val ride = pids.ride
    val color = lineColorOf(lines[ride.line]?.colorCode)
    val ink = if (color.luminance() > 0.6f) YishunInk else Color.White
    val slots: List<Slot> = buildList {
        strip.stops.forEach { stop ->
            if (stop.last && strip.skipped > 0) add(Slot.Gap(strip.skipped))
            add(Slot.Stop(stop))
        }
    }
    val description = strip.stops.filter { !it.passed }.joinToString { it.name }
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(StripHeight)
            .clipToBounds()
            .clearAndSetSemantics { contentDescription = description },
    ) {
        val pitch = ((maxWidth - StripStart - StripEnd) / slots.size).coerceAtMost(SlotWidth * 2)
        fun centre(i: Int): Dp = StripStart + pitch * i + pitch / 2
        val focusAt = slots.indexOfFirst { it is Slot.Stop && it.stop.focus }
        val firstBehind = (strip.stops.first().index > 0)

        // The line, the band behind the stop in focus, and the dashed stretch the "+N" stands for.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(StripHeight)
                .drawBehind {
                    val y = LineY.toPx()
                    val thick = LineThickness.toPx()
                    if (focusAt >= 0) {
                        // Along the focus stop's name: through where it rises from, at its slant.
                        val run = 1f / tan(Math.toRadians(NAME_ANGLE_DEG.toDouble())).toFloat()
                        val rise = (LineY - PillHeight / 2 - NameGap).toPx()
                        // A name's middle runs through about where it rises from, its height spread either side.
                        val from = nameStartOf(centre(focusAt)).toPx()
                        val bottom = y + 14.dp.toPx()
                        val half = 17.dp.toPx()
                        fun across(atY: Float) = from + (rise - atY) * run
                        val band = Path().apply {
                            moveTo(across(bottom) - half, bottom)
                            lineTo(across(bottom) + half, bottom)
                            lineTo(across(0f) + half, 0f)
                            lineTo(across(0f) - half, 0f)
                            close()
                        }
                        drawPath(band, YishunBand)
                    }
                    // Into the strip from the left when there are stops behind it.
                    if (firstBehind) {
                        drawLine(YishunPassed, Offset(0f, y), Offset(centre(0).toPx(), y), thick)
                    }
                    for (i in 0 until slots.lastIndex) {
                        val a = centre(i).toPx()
                        val b = centre(i + 1).toPx()
                        val gap = slots[i] is Slot.Gap || slots[i + 1] is Slot.Gap
                        val passed = (slots[i + 1] as? Slot.Stop)?.stop?.let { it.passed || it.focus } == true
                        drawLine(
                            color = if (passed) YishunPassed else color,
                            start = Offset(a, y),
                            end = Offset(b, y),
                            strokeWidth = thick,
                            pathEffect = if (gap) PathEffect.dashPathEffect(floatArrayOf(thick * 1.2f, thick)) else null,
                        )
                    }
                },
        )

        slots.forEachIndexed { i, slot ->
            val x = centre(i)
            when (slot) {
                is Slot.Gap -> Text(
                    text = stringResource(R.string.trip_yishun_skipped, slot.skipped),
                    modifier = Modifier
                        .offset(x = x - SlotWidth / 2, y = LineY + 8.dp)
                        .width(SlotWidth),
                    style = MaterialTheme.typography.labelMedium.merge(fontFeatureSettings = TABULAR),
                    fontWeight = FontWeight.Bold,
                    color = YishunMuted,
                    textAlign = TextAlign.Center,
                )
                is Slot.Stop -> StopMarks(
                    stop = slot.stop,
                    x = x,
                    stripWidth = maxWidth,
                    color = color,
                    ink = ink,
                    transfers = stationLines[slot.stop.id].orEmpty().filter { it != ride.line }.take(TRANSFER_ROUNDELS),
                    lines = lines,
                )
            }
        }
    }
}

/** A stop's pill on the line, its name leaning up from it, and under it its other lines and "Turun". */
@Composable
private fun StopMarks(
    stop: YishunStop,
    x: Dp,
    stripWidth: Dp,
    color: Color,
    ink: Color,
    transfers: List<String>,
    lines: Map<String, LineInfo>,
) {
    // The name leans from just above the pill's left edge: as long as fits under the top and short of the right.
    val angle = Math.toRadians(NAME_ANGLE_DEG.toDouble())
    val rise = LineY - PillHeight / 2 - NameGap
    val nameStart = nameStartOf(x)
    val byHeight = rise / sin(angle).toFloat()
    val byWidth = (stripWidth - nameStart - 4.dp) / cos(angle).toFloat()
    val nameMax = minOf(byHeight, byWidth)
    Text(
        text = stop.name,
        modifier = Modifier
            .offset(x = nameStart, y = rise - 18.dp)
            .widthIn(max = nameMax)
            .graphicsLayer {
                rotationZ = -NAME_ANGLE_DEG
                transformOrigin = TransformOrigin(0f, 1f)
            },
        style = MaterialTheme.typography.labelLarge.copy(fontSize = if (stop.focus) 14.sp else 12.5.sp, lineHeight = 18.sp),
        fontWeight = if (stop.focus) FontWeight.ExtraBold else FontWeight.Bold,
        color = if (stop.passed) YishunPassedText else Color.White,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )

    val fill = when {
        stop.focus -> Color.White
        stop.passed -> YishunPassed
        else -> color
    }
    val text = when {
        stop.passed -> "·"
        else -> stop.minutes?.toString().orEmpty()
    }
    Box(
        modifier = Modifier
            .offset(x = x - SlotWidth / 2, y = LineY - PillHeight / 2)
            .width(SlotWidth),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .height(PillHeight)
                .widthIn(min = PillMinWidth)
                .background(fill, RoundedCornerShape(8.dp))
                // The stop to get off at ringed in white; the rest kept apart from the line by the panel's ink.
                .border(2.dp, if (stop.last) Color.White else YishunInk, RoundedCornerShape(8.dp))
                .padding(horizontal = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium.merge(fontFeatureSettings = TABULAR),
                fontWeight = FontWeight.ExtraBold,
                color = when {
                    stop.focus -> YishunInk
                    stop.passed -> YishunPassedText
                    else -> ink
                },
                maxLines = 1,
            )
        }
    }

    Column(
        modifier = Modifier
            .offset(x = x - TagWidth / 2, y = LineY + PillHeight / 2 + 4.dp)
            .width(TagWidth),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        if (stop.last) {
            Text(
                text = stringResource(R.string.trip_yishun_alight),
                modifier = Modifier
                    .background(YishunAlight, RoundedCornerShape(5.dp))
                    .padding(horizontal = 5.dp, vertical = 1.dp),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White,
                maxLines = 1,
            )
        }
        if (transfers.isNotEmpty()) {
            Row(
                modifier = Modifier.alpha(if (stop.passed) 0.45f else 1f),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                transfers.forEach { key ->
                    val info = lines[key]
                    LineRoundel(
                        code = info?.lineCode ?: key.substringAfter(':'),
                        color = info?.colorCode ?: "#94A3B8",
                        operator = key.substringBefore(':'),
                        size = RoundelSize.SM,
                    )
                }
            }
        }
    }
}
