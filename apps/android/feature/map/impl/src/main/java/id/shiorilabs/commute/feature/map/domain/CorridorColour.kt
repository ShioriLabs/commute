package id.shiorilabs.commute.feature.map.domain

import kotlin.math.abs
import kotlin.math.max

/*
 * A corridor's artwork colour against a line's brand colour, the web's `map-corridor-colour.ts`.
 * The two palettes are related but not identical, so "is this stroke this line's" is a tolerance
 * question, and every use falls back to colour-blind matching rather than dropping a segment. (Its
 * ink election stays behind: only the web's build-time line tracer uses it.)
 */

/** The worst per-channel difference between two `#rrggbb` colours, 0..255; 255 for one unreadable. */
fun channelDistance(a: String, b: String): Int {
    if (a.length < 7 || b.length < 7) return 255
    var worst = 0
    for (i in 1 until 7 step 2) {
        val av = a.substring(i, i + 2).toIntOrNull(16) ?: return 255
        val bv = b.substring(i, i + 2).toIntOrNull(16) ?: return 255
        worst = max(worst, abs(av - bv))
    }
    return worst
}

/**
 * How far a stroke's colour may sit from a line's brand and still be it, per channel. The worst
 * drift of a line from its own stroke is 37 (KCI:C); the confusion the gate exists for, yellow
 * traced onto blue, is 165 apart. Similar reds and blues stay alike: a discriminator, not identity.
 */
const val CORRIDOR_COLOUR_TOLERANCE = 72

/**
 * Whether a stroke in [corridorColour] can be [lineColour]'s, or one of [sharedTrackColours]: the
 * lines that also serve both stops of the pair, as shared track is drawn once in one line's colour
 * (LRT Jabodebek's trunk, Manggarai to Sudirman). Unknown either side is no mismatch.
 */
fun colourMatches(corridorColour: String?, lineColour: String?, sharedTrackColours: List<String> = emptyList()): Boolean {
    if (corridorColour.isNullOrEmpty() || lineColour.isNullOrEmpty()) return true
    if (channelDistance(corridorColour, lineColour) <= CORRIDOR_COLOUR_TOLERANCE) return true
    return sharedTrackColours.any { channelDistance(corridorColour, it) <= CORRIDOR_COLOUR_TOLERANCE }
}
