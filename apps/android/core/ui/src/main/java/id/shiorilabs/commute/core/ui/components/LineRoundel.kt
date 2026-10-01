package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import id.shiorilabs.commute.core.ui.ext.Foreground
import id.shiorilabs.commute.core.ui.ext.foreground
import id.shiorilabs.commute.core.ui.ext.parseHexColor
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.RoundelFontFamily
import id.shiorilabs.commute.core.ui.theme.RoundelNarrowFontFamily

/** The text colour on a roundel's white face, and on a pale filled one. */
private val RoundelInk = Color(0xFF0F172A)

/**
 * Roundel metrics, matching the web's `line-roundel.tsx`. [SM] is [MD] at ~2/3, keeping the ring at
 * ≈13.5% of the diameter.
 *
 * Text sizes are in dp, not sp: a roundel is a fixed badge, and letting the system font scale grow
 * the code past its circle would break it rather than make it more legible.
 */
enum class RoundelSize(
    internal val diameter: Dp,
    internal val ring: Dp,
    internal val text: Dp,
    internal val compactText: Dp,
    internal val icon: Dp,
) {
    MD(diameter = 36.dp, ring = 5.dp, text = 16.dp, compactText = 14.dp, icon = 18.dp),
    SM(diameter = 24.dp, ring = 3.dp, text = 11.dp, compactText = 9.dp, icon = 12.dp),
}

/**
 * A line's roundel, in Jak Lingko's published grammar (docs/jaklingko-wayfinding.md): rail lines get
 * a white face with a coloured ring carrying a letter, TransJakarta corridors a filled circle
 * carrying a number. It is what lets a rider tell a corridor from a line before reading either.
 *
 * The Kalayang (`APCGK`) is signed with an aircraft instead of a code, the way FDTJ drew it.
 *
 * Decorative to accessibility services: callers put the line's name next to it.
 *
 * @param color the line colour, as the API sends it (`#RRGGBB`).
 * @param operator the line's operator code; `TJ` renders filled, `APCGK` the aircraft.
 */
@Composable
fun LineRoundel(
    code: String,
    color: String,
    modifier: Modifier = Modifier,
    operator: String? = null,
    size: RoundelSize = RoundelSize.MD,
) {
    val lineColor = parseHexColor(color)
    val filled = operator == OPERATOR_TJ
    val pictogram = operator == OPERATOR_APCGK
    val ink = if (filled && lineColor.foreground() == Foreground.LIGHT) Color.White else RoundelInk
    val compact = code.length >= 2

    Box(
        modifier = modifier
            .size(size.diameter)
            .then(
                if (filled) {
                    Modifier.background(lineColor, CircleShape)
                } else {
                    Modifier
                        .background(Color.White, CircleShape)
                        .border(size.ring, lineColor, CircleShape)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (pictogram) {
            Icon(
                imageVector = CommuteIcons.Airplane,
                contentDescription = null,
                modifier = Modifier.size(size.icon),
                tint = ink,
            )
        } else {
            val fontSize = with(LocalDensity.current) {
                (if (compact) size.compactText else size.text).toSp()
            }
            Text(
                text = code,
                style = TextStyle(
                    // Narrow is the standard's sanctioned face when space is tight, which is
                    // exactly what a multi-character code sharing one circle is.
                    fontFamily = if (compact) RoundelNarrowFontFamily else RoundelFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = fontSize,
                    lineHeight = 1.em,
                    color = ink,
                    platformStyle = PlatformTextStyle(includeFontPadding = false),
                    lineHeightStyle = LineHeightStyle(
                        alignment = LineHeightStyle.Alignment.Center,
                        trim = LineHeightStyle.Trim.Both,
                    ),
                ),
            )
        }
    }
}

private const val OPERATOR_TJ = "TJ"
private const val OPERATOR_APCGK = "APCGK"

@Preview(showBackground = true)
@Composable
private fun LineRoundelPreview() {
    CommutePreviewScaffold {
        Row {
            LineRoundel(code = "C", color = "#25B8EB", operator = "KCI")
            LineRoundel(code = "M", color = "#DD0067", operator = "MRTJ")
            LineRoundel(code = "13", color = "#5C2D91", operator = "TJ")
            LineRoundel(code = "KLB", color = "#9CA3AF", operator = "APCGK")
            LineRoundel(code = "B", color = "#EE3D43", operator = "KCI", size = RoundelSize.SM)
            LineRoundel(code = "1A", color = "#FFD200", operator = "TJ", size = RoundelSize.SM)
        }
    }
}
