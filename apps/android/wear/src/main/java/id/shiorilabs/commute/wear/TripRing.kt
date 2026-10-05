package id.shiorilabs.commute.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * The trip's progress around the edge of the screen, as the phone's Live Update bar: one arc per
 * ride in its line's colour, a gap at each change, ridden faint to solid.
 */
@Composable
fun TripRing(rideFractions: List<Double>, fraction: Double, colors: List<Color>, modifier: Modifier = Modifier) {
    Canvas(modifier.padding(3.dp)) {
        val stroke = 5.dp.toPx()
        val inset = stroke / 2
        val arcSize = Size(size.width - stroke, size.height - stroke)
        val gaps = if (rideFractions.size > 1) rideFractions.size * GAP_DEGREES else 0f
        val available = 360f - gaps
        var angle = START_DEGREES
        var before = 0.0
        rideFractions.forEachIndexed { i, share ->
            val sweep = (share * available).toFloat()
            val color = colors.getOrElse(i) { Color.Gray }
            drawArc(color.copy(alpha = TRACK_ALPHA), angle, sweep, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            val ridden = if (share == 0.0) 0.0 else ((fraction - before) / share).coerceIn(0.0, 1.0)
            if (ridden > 0) {
                drawArc(color, angle, (sweep * ridden).toFloat(), false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            angle += sweep + if (rideFractions.size > 1) GAP_DEGREES else 0f
            before += share
        }
    }
}

/** Twelve o'clock. */
private const val START_DEGREES = -90f
private const val GAP_DEGREES = 4f
private const val TRACK_ALPHA = 0.3f
