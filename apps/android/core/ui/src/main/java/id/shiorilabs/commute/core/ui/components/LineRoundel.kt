package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
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
import kotlin.math.roundToInt

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
    /** Public so a layout can line other things up with a roundel's edge or centre. */
    val diameter: Dp,
    internal val ring: Dp,
    internal val text: Dp,
    internal val compactText: Dp,
    internal val icon: Dp,
    /**
     * A station number's prefix of more than one character, stacked over its position (which, like
     * a one-letter prefix, takes [compactText]).
     */
    internal val prefixText: Dp,
    /** The Kalayang's aircraft standing in for that prefix. */
    internal val prefixIcon: Dp,
) {
    MD(diameter = 36.dp, ring = 5.dp, text = 16.dp, compactText = 14.dp, icon = 18.dp, prefixText = 8.dp, prefixIcon = 9.dp),
    SM(diameter = 24.dp, ring = 3.dp, text = 11.dp, compactText = 9.dp, icon = 12.dp, prefixText = 6.dp, prefixIcon = 7.dp),
}

/**
 * A line's roundel, in Jak Lingko's published grammar (docs/jaklingko-wayfinding.md): rail lines get
 * a white face with a coloured ring carrying a letter, TransJakarta corridors a filled circle
 * carrying a number. It is what lets a rider tell a corridor from a line before reading either.
 *
 * With [station], [code] is a station number (`C13`, `13-4`) stacked as the line's prefix over the
 * stop's position, as the FDTJ map prints them; the web's `station` roundel.
 *
 * The Kalayang (`APCGK`) is signed with an aircraft instead of a code, the way FDTJ drew it. Its
 * station numbers stack the aircraft over the position in place of the prefix: K01 reads as ✈/01.
 *
 * Decorative to accessibility services: callers put the line's name next to it.
 *
 * @param color the line colour, as the API sends it (`#RRGGBB`).
 * @param operator the line's operator code; `TJ` renders filled, `APCGK` the aircraft.
 * @param filled a solid circle in the line's colour rather than a ring; by default a TransJakarta
 *   corridor's. A line page fills the stations its strip is anchored on (termini, junctions).
 */
@Composable
fun LineRoundel(
    code: String,
    color: String,
    modifier: Modifier = Modifier,
    operator: String? = null,
    size: RoundelSize = RoundelSize.MD,
    station: Boolean = false,
    filled: Boolean = operator == OPERATOR_TJ,
) {
    val lineColor = parseHexColor(color)
    val pictogram = operator == OPERATOR_APCGK
    val ink = if (filled && lineColor.foreground() == Foreground.LIGHT) Color.White else RoundelInk
    val compact = station || code.length >= 2

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
        when {
            station -> {
                val (prefix, position) = splitStationNumber(code)
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // Sized to the prefix's slot, which the aircraft stands in for.
                    if (pictogram) {
                        Icon(
                            imageVector = CommuteIcons.Airplane,
                            contentDescription = null,
                            modifier = Modifier.size(size.prefixIcon),
                            tint = ink,
                        )
                    } else if (prefix.isNotEmpty()) {
                        // A single letter matches the position under it; a longer prefix ("TP", a
                        // corridor's "13") would crowd the circle at that size, so it shrinks.
                        val prefixSize = if (prefix.length == 1) size.compactText else size.prefixText
                        RoundelText(prefix, prefixSize, compact = true, ink, stacked = true)
                    }
                    RoundelText(position, size.compactText, compact = true, ink, stacked = true)
                }
            }

            pictogram -> Icon(
                imageVector = CommuteIcons.Airplane,
                contentDescription = null,
                modifier = Modifier.size(size.icon),
                tint = ink,
            )

            else -> RoundelText(code, if (compact) size.compactText else size.text, compact, ink)
        }
    }
}

/**
 * How tall each line of a stacked station number lays out, as a share of its font size: about its
 * cap height. At the font's own height the prefix and the position sit apart by the room left for
 * descenders, which capitals and digits never use. A line height can't do this: Compose never
 * shrinks a single line below the font's own ascent and descent.
 */
private const val STACKED_LINE_SHARE = 0.75f

/**
 * [stacked] for a line of a station number, laid out [STACKED_LINE_SHARE] tall with its glyphs
 * centred, so they overhang the box only by the font's empty ascent and descent; otherwise the code
 * alone, at the font's own height.
 */
@Composable
private fun RoundelText(
    text: String,
    size: Dp,
    compact: Boolean,
    color: Color,
    stacked: Boolean = false,
) {
    val fontSize = with(LocalDensity.current) { size.toSp() }
    Text(
        text = text,
        modifier = if (stacked) {
            Modifier.layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                val height = (size.toPx() * STACKED_LINE_SHARE).roundToInt()
                layout(placeable.width, height) {
                    placeable.place(0, (height - placeable.height) / 2)
                }
            }
        } else {
            Modifier
        },
        style = TextStyle(
            // Narrow is the standard's sanctioned face when space is tight, which is exactly what
            // a multi-character code sharing one circle, or a stacked station number, is.
            fontFamily = if (compact) RoundelNarrowFontFamily else RoundelFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = fontSize,
            lineHeight = 1.em,
            color = color,
            platformStyle = PlatformTextStyle(includeFontPadding = false),
            lineHeightStyle = LineHeightStyle(
                alignment = LineHeightStyle.Alignment.Center,
                trim = LineHeightStyle.Trim.Both,
            ),
        ),
    )
}

private const val OPERATOR_TJ = "TJ"
private const val OPERATOR_APCGK = "APCGK"

@Preview(showBackground = true)
@Composable
private fun LineRoundelPreview() {
    CommutePreviewScaffold {
        Column {
            Row {
                LineRoundel(code = "C", color = "#25B8EB", operator = "KCI")
                LineRoundel(code = "M", color = "#DD0067", operator = "MRTJ")
                LineRoundel(code = "13", color = "#5C2D91", operator = "TJ")
                LineRoundel(code = "KLB", color = "#9CA3AF", operator = "APCGK")
                LineRoundel(code = "B", color = "#EE3D43", operator = "KCI", size = RoundelSize.SM)
                LineRoundel(code = "1A", color = "#FFD200", operator = "TJ", size = RoundelSize.SM)
            }
            Row {
                LineRoundel(code = "C13", color = "#25B8EB", operator = "KCI", station = true)
                LineRoundel(code = "B01", color = "#EE3D43", operator = "KCI", station = true, filled = true)
                LineRoundel(code = "13-4", color = "#5C2D91", operator = "TJ", station = true)
                LineRoundel(code = "K01", color = "#9CA3AF", operator = "APCGK", station = true)
            }
        }
    }
}
