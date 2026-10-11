package id.shiorilabs.commute.core.font

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight

/*
 * The app's faces, bundled once for the phone and the watch both.
 */

private fun plusJakartaSans(weight: FontWeight) = Font(
    resId = R.font.plus_jakarta_sans,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

/**
 * Plus Jakarta Sans, the UI face on web too. One variable-weight file is bundled and each weight
 * below is an instance of it, so adding a weight costs no download size. There is no italic: the
 * family has a separate italic file that is not bundled, and `FontStyle.Italic` would fall back to
 * a synthetic slant.
 */
val PlusJakartaSansFontFamily = FontFamily(
    plusJakartaSans(FontWeight.Normal),
    plusJakartaSans(FontWeight.Medium),
    plusJakartaSans(FontWeight.SemiBold),
    plusJakartaSans(FontWeight.Bold),
    plusJakartaSans(FontWeight.ExtraBold),
)

/*
 * PT Sans is the face the Jak Lingko wayfinding standard specifies for roundels, and it is used
 * inside roundels ONLY (docs/jaklingko-wayfinding.md): the roundel reproduces a physical badge, so
 * matching its type is what makes it read as the real thing. Everything else stays on Plus Jakarta
 * Sans.
 *
 * Both files are subset to [0-9A-Za-z], a roundel's entire character set, exactly as the web's are,
 * so they cost ~100 KB together rather than ~1 MB. A character outside that set renders in the
 * platform's fallback, which is the cue to widen the subset rather than to use this elsewhere.
 */

/** A one-character code alone in its circle. */
val RoundelFontFamily = FontFamily(Font(R.font.pt_sans_bold, FontWeight.Bold))

/** The standard's own answer for constrained space: multi-character codes sharing one circle. */
val RoundelNarrowFontFamily = FontFamily(Font(R.font.pt_sans_narrow_bold, FontWeight.Bold))
