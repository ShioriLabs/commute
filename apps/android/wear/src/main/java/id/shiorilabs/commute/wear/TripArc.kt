package id.shiorilabs.commute.wear

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * The trip's progress along the edge of the screen, as the phone's Live Update bar: open at the
 * bottom as Health's heart-rate arc is, from eight o'clock over the top to four, one stretch per
 * ride in its line's colour, a gap at each change, ridden faint to solid, and a dot where the rider
 * is. [thickness] grows in from the screen's edge, so an arc thinned to nothing as the list scrolls
 * slips off the edge.
 */
@Composable
fun TripArc(rideFractions: List<Double>, fraction: Double, colors: List<Color>, thickness: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val stroke = thickness.toPx()
        if (stroke < MIN_STROKE_PX) return@Canvas
        val inset = stroke / 2
        val arcSize = Size(size.width - stroke, size.height - stroke)
        val available = SWEEP_DEGREES - (rideFractions.size - 1).coerceAtLeast(0) * GAP_DEGREES
        var angle = START_DEGREES
        var before = 0.0
        var dotAngle: Float? = null
        rideFractions.forEachIndexed { i, share ->
            val sweep = (share * available).toFloat()
            val color = colors.getOrElse(i) { Color.Gray }
            drawArc(color.copy(alpha = TRACK_ALPHA), angle, sweep, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            val ridden = if (share == 0.0) 0.0 else ((fraction - before) / share).coerceIn(0.0, 1.0)
            if (ridden > 0) {
                drawArc(color, angle, (sweep * ridden).toFloat(), false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            // The ride the rider is on, or waiting for: the dot sits where they've got to along it.
            if (dotAngle == null && (fraction < before + share || i == rideFractions.lastIndex)) {
                dotAngle = angle + (sweep * ridden).toFloat()
            }
            angle += sweep + GAP_DEGREES
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
private const val GAP_DEGREES = 4f
private const val TRACK_ALPHA = 0.3f
private const val DOT_SCALE = 0.7f
private const val DOT_SHADOW_ALPHA = 0.35f

/** Thinner than this, the arc is gone: nothing is drawn. */
private const val MIN_STROKE_PX = 0.5f
