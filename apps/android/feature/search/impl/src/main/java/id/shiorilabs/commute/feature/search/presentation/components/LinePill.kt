package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.ext.Foreground
import id.shiorilabs.commute.core.ui.ext.foreground
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.feature.search.domain.SearchLine

/** Near-black text on a pale line colour, the web's `text-slate-900`. */
private val DarkInk = Color(0xFF0F172A)

/**
 * A line as a pill in its own colour, named without the "Lin " every line name starts with: it is
 * obvious from the pill, and dropping it is what lets the chips wrap tightly.
 */
@Composable
fun LinePill(
    line: SearchLine,
    modifier: Modifier = Modifier,
) {
    val color = parseHexColor(line.colorCode)

    Text(
        text = line.name.removePrefix("Lin "),
        modifier = modifier
            .background(color, CircleShape)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
        color = if (color.foreground() == Foreground.LIGHT) Color.White else DarkInk,
    )
}
