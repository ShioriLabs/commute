package id.shiorilabs.commute.core.ui.ext

import androidx.compose.ui.graphics.Color
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
 * This colour washed towards white: [factor] of the colour, the rest white. `0.2f` is the pale
 * card background the web derives from a line colour.
 */
fun Color.tint(factor: Float = 0.2f): Color {
    fun channel(value: Float) = ((value * 255 * factor + 255 * (1 - factor)).roundToInt()) / 255f
    return Color(red = channel(red), green = channel(green), blue = channel(blue))
}
