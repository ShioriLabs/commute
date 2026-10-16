package id.shiorilabs.commute.core.ui.ext

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import id.shiorilabs.commute.core.ui.theme.LocalDarkTheme
import id.shiorilabs.commute.core.ui.theme.Fixed
import kotlin.math.roundToInt

/**
 * Parses a `#RRGGBB` or `#RGB` colour, as the API sends line colours. A malformed value comes back
 * as [fallback] rather than throwing: a wrong colour on a roundel beats a crash in a list.
 */
fun parseHexColor(hex: String, fallback: Color = Color.Gray): Color {
    val digits = hex.removePrefix("#").let { raw ->
        if (raw.length == 3) raw.map { "$it$it" }.joinToString("") else raw
    }
    if (digits.length != 6) {
        return fallback
    }
    val rgb = digits.toLongOrNull(16) ?: return fallback
    return Color(0xFF000000 or rgb)
}

/**
 * A line's colour from its [colorCode], or slate when there is none yet (the line dictionary still
 * loading) or it doesn't parse: the web's `LINE_COLOR_FALLBACK`, so a card renders grey rather than
 * blanking.
 */
fun lineColorOf(colorCode: String?): Color = colorCode?.let { parseHexColor(it, Fixed.Slate400) } ?: Fixed.Slate400

/** Which text colour reads on a background. */
enum class Foreground {
    /** White text. */
    LIGHT,

    /** Near-black text. */
    DARK,
}

/** Perceived brightness above which a background takes dark text, on a 0–255 scale. */
private const val DARK_TEXT_LUMINANCE = 186f

/**
 * Which text colour reads on this background. The same weighted luminance and threshold as the web
 * app (`utils/colors.ts`), so a line pill picks the same text colour on both.
 */
fun Color.foreground(): Foreground {
    val luminance = 0.299f * red * 255 + 0.587f * green * 255 + 0.114f * blue * 255
    return if (luminance > DARK_TEXT_LUMINANCE) Foreground.DARK else Foreground.LIGHT
}

/**
 * This colour washed towards [base] (white): [factor] of the colour, the rest [base]. `0.2f` is the pale
 * card background the web derives from a line colour.
 */
fun Color.tint(factor: Float = 0.2f, base: Color = Color.White): Color {
    fun channel(value: Float, ground: Float) = ((value * 255 * factor + ground * 255 * (1 - factor)).roundToInt()) / 255f
    return Color(red = channel(red, base.red), green = channel(green, base.green), blue = channel(blue, base.blue))
}

/**
 * [tint] on the theme's own ground: white on the light theme, as the web, and the dark themes'
 * card surface otherwise, so a line's card is that line's hue on the dark rather than a pale slab.
 */
@Composable
fun Color.themedTint(factor: Float = 0.2f): Color {
    val base = if (LocalDarkTheme.current) MaterialTheme.colorScheme.surfaceContainer else Color.White
    return tint(factor, base)
}
