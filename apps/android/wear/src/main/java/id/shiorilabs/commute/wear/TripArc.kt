package id.shiorilabs.commute.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * The trip's progress along the edge of the screen, as the phone's Live Update bar: open at the
 * bottom as Health's heart-rate arc is, from eight o'clock over the top to four, one stretch per
 * ride in its line's colour, ridden dark to bright, and a dot where the rider is. At a change the
 * next ride starts a dot's width back over the last one's end, its round cap on top: a handoff,
 * where a gap between two round ends read as a break. [thickness] grows in from the screen's edge, so an arc thinned to nothing as the list scrolls
 * slips off the edge.
 */
@Composable
fun TripArc(rideFractions: List<Double>, fraction: Double, colors: List<Color>, thickness: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val stroke = thickness.toPx()
        if (stroke < MIN_STROKE_PX) return@Canvas
        val inset = stroke / 2
        val arcSize = Size(size.width - stroke, size.height - stroke)
        val radius = size.minDimension / 2 - inset
        val overlap = Math.toDegrees((stroke / radius).toDouble()).toFloat()
        val available = SWEEP_DEGREES + (rideFractions.size - 1).coerceAtLeast(0) * overlap
        var angle = START_DEGREES
        var before = 0.0
        var dotAngle: Float? = null
        rideFractions.forEachIndexed { i, share ->
            val sweep = (share * available).toFloat()
            val color = colors.getOrElse(i) { Color.Gray }
            // Opaque, so where two rides overlap the later one covers the earlier cleanly.
            drawArc(lerp(Color.Black, color, TRACK_SHADE), angle, sweep, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            val ridden = if (share == 0.0) 0.0 else ((fraction - before) / share).coerceIn(0.0, 1.0)
            if (ridden > 0) {
                drawArc(color, angle, (sweep * ridden).toFloat(), false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            // The ride the rider is on, or waiting for: the dot sits where they've got to along it.
            if (dotAngle == null && (fraction < before + share || i == rideFractions.lastIndex)) {
                dotAngle = angle + (sweep * ridden).toFloat()
            }
            angle += sweep - overlap
            before += share
        }
        dotAngle?.let { drawDot(it, inset, stroke) }
    }
}

/** A white dot on the arc's centre line at [degrees], a shade narrower than the arc. */
private fun DrawScope.drawDot(degrees: Float, inset: Float, stroke: Float) {
    val radians = Math.toRadians(degrees.toDouble())
    val arcRadius = size.minDimension / 2 - inset
    val at = Offset(
        center.x + (arcRadius * cos(radians)).toFloat(),
        center.y + (arcRadius * sin(radians)).toFloat(),
    )
    drawCircle(Color.Black.copy(alpha = DOT_SHADOW_ALPHA), radius = stroke / 2, center = at)
    drawCircle(Color.White, radius = stroke * DOT_SCALE / 2, center = at)
}

/** Eight o'clock, near enough, round over the top to four: the bottom left open. */
private const val START_DEGREES = 150f
private const val SWEEP_DEGREES = 240f
/** How much of a ride's colour its track still to be ridden shows, over black. */
private const val TRACK_SHADE = 0.4f
private const val DOT_SCALE = 0.7f
private const val DOT_SHADOW_ALPHA = 0.35f

/** Thinner than this, the arc is gone: nothing is drawn. */
private const val MIN_STROKE_PX = 0.5f

@Preview(widthDp = 192, heightDp = 192, showBackground = true, backgroundColor = 0xFF000000)
@Composable
private fun TripArcPreview() {
    CommuteWatchTheme {
        TripArc(
            rideFractions = listOf(0.7, 0.3),
            fraction = 0.45,
            colors = listOf(Color(0xFFE4002B), Color(0xFF00A9E0)),
            thickness = 8.dp,
            modifier = Modifier.size(192.dp),
        )
    }
}
