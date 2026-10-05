package id.shiorilabs.commute.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.wear.compose.material3.Text

/** PT Sans, inside roundels only, as Jak Lingko's wayfinding standard and the phone's roundels have it. */
private val RoundelFont = FontFamily(Font(R.font.pt_sans_bold, FontWeight.Bold))

/** The standard's face for a code of two or more characters sharing one circle. */
private val RoundelNarrowFont = FontFamily(Font(R.font.pt_sans_narrow_bold, FontWeight.Bold))

private val RoundelInk = Color(0xFF0F172A)

/**
 * A line's roundel, as the phone draws it at its small size: a rail line's white face in a ring of
 * the line's colour, a TransJakarta corridor's filled circle. Decorative: the line's name is beside it.
 */
@Composable
fun Roundel(code: String, color: Color, operator: String, modifier: Modifier = Modifier) {
    val filled = operator == OPERATOR_TJ
    val ink = if (filled && !color.wantsDarkInk()) Color.White else RoundelInk
    val compact = code.length >= 2
    val fontSize = with(LocalDensity.current) { (if (compact) 9.dp else 11.dp).toSp() }
    Box(
        modifier = modifier
            .size(DIAMETER)
            .then(
                if (filled) {
                    Modifier.background(color, CircleShape)
                } else {
                    Modifier.background(Color.White, CircleShape).border(RING, color, CircleShape)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            code,
            style = TextStyle(
                fontFamily = if (compact) RoundelNarrowFont else RoundelFont,
                fontWeight = FontWeight.Bold,
                fontSize = fontSize,
                lineHeight = 1.em,
                color = ink,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
                lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both),
            ),
        )
    }
}

/** The phone's rule for text on a line colour: dark above a perceived brightness of 186 of 255. */
private fun Color.wantsDarkInk(): Boolean = (0.299f * red + 0.587f * green + 0.114f * blue) * 255 > 186f

private val DIAMETER = 24.dp
private val RING = 3.dp
private const val OPERATOR_TJ = "TJ"
