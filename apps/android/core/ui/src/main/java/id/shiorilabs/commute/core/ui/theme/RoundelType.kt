package id.shiorilabs.commute.core.ui.theme

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import id.shiorilabs.commute.core.ui.R

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
