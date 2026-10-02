package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.RouteBarSegment

/** The rail's gauge: the track is drawn at it rather than filled to the row, which reads as a button. */
internal val RailWidth = 6.dp

/** A ride is never narrower than the roundel at its head. */
private val MinRideWidth = 24.dp

/**
 * Interlined track: each line owns an equal band of the track. Hard bands rather than the web's
 * blended seams; at this gauge the blend is a pixel or two either way.
 */
internal fun trackBrush(colors: List<String>, vertical: Boolean): Brush {
    val distinct = colors.distinct().map { parseHexColor(it) }
    if (distinct.size <= 1) {
        return Brush.linearGradient(listOf(distinct.firstOrNull() ?: Color.Gray, distinct.firstOrNull() ?: Color.Gray))
    }
    val stops = distinct.flatMapIndexed { index, color ->
        val start = index.toFloat() / distinct.size
        val end = (index + 1).toFloat() / distinct.size
        listOf(start to color, end to color)
    }.toTypedArray()
    return if (vertical) Brush.verticalGradient(*stops) else Brush.horizontalGradient(*stops)
}

/**
 * The journey at a glance: rides sized by the ground they cover, each with its line's roundel at the
 * head, and every walk between them a leg of its own with its distance. The web's `RouteBar`.
 */
@Composable
internal fun RouteBar(segments: List<RouteBarSegment>, plateColor: Color, modifier: Modifier = Modifier) {
    val spoken = segments.mapNotNull { segment ->
        when (segment) {
            is RouteBarSegment.Ride -> segment.name.takeIf { it.isNotEmpty() }
            is RouteBarSegment.Walk -> segment.distanceM?.let { stringResource(R.string.journey_route_walk_description, it) }
                ?: stringResource(R.string.journey_route_change_description)
        }
    }
    val description = if (spoken.isEmpty()) {
        stringResource(R.string.journey_route_description_empty)
    } else {
        stringResource(R.string.journey_route_description, spoken.joinToString(", "))
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        segments.forEach { segment ->
            when (segment) {
                is RouteBarSegment.Walk -> WalkSegment(segment.distanceM)
                is RouteBarSegment.Ride -> Box(
                    modifier = Modifier
                        // Weight by distance alone, floored at the roundel it carries.
                        .weight(segment.distanceM.coerceAtLeast(1).toFloat())
                        .widthIn(min = MinRideWidth)
                        .height(24.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(RailWidth)
                            .clip(CircleShape)
                            .background(trackBrush(segment.colors, vertical = false)),
                    )
                    // A halo in the plate's colour keeps a filled TJ roundel apart from its own track.
                    LineRoundel(
                        code = segment.code,
                        color = segment.colors.first(),
                        operator = segment.operator,
                        size = RoundelSize.SM,
                        modifier = Modifier.border(2.dp, plateColor, CircleShape),
                    )
                }
            }
        }
    }
}

@Composable
private fun WalkSegment(distanceM: Int?) {
    Row(
        modifier = Modifier
            .height(24.dp)
            .clip(CircleShape)
            .background(Slate400)
            .padding(start = 2.dp, end = if (distanceM != null) 8.dp else 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(CircleShape)
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Icon(imageVector = CommuteIcons.Walk, contentDescription = null, modifier = Modifier.size(12.dp), tint = Slate500)
        }
        if (distanceM != null) {
            Text(text = "$distanceM m", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }
    }
}
