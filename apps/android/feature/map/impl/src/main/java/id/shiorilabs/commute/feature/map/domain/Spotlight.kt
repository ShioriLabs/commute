package id.shiorilabs.commute.feature.map.domain

import kotlin.math.min
import kotlin.math.pow

/**
 * The selected station's spotlight over time, the web's `spotlightRef` phases: in over
 * [IN_MS] on an ease-out cubic, held, then out over [OUT_MS] from wherever it had got to.
 *
 * Pure: [frame] is asked for the overlay at a time, and says nothing of drawing.
 */
class Spotlight(
    val point: MapPoint,
    /** The station's drawn name, cleared alongside its marker; null when none is drawn. */
    val label: MapPoint?,
    color: Rgb,
    startMs: Long,
    /** The fade already on screen when it began, which it carries on from: see [seedFadeFrom]. */
    fadeFrom: Double = 0.0,
) {

    /** The ring's colour: neutral until the station's line colour arrives. */
    var color: Rgb = color

    private enum class Phase { IN, HOLD, OUT }

    private var phase = Phase.IN
    private var phaseStartMs = startMs
    private var fadeFrom = fadeFrom
    private var ringFrom = 0.0

    /** The fade drawn on the last [frame], for whatever takes over to start from. */
    var lastFade: Double = fadeFrom
        private set
    private var lastRing = 0.0

    /** Whether it has finished fading out; nothing is drawn for it any more. */
    var isGone: Boolean = false
        private set

    /** Whether [frame] changes from one moment to the next: a frame is due while it does. */
    val isAnimating: Boolean get() = !isGone && phase != Phase.HOLD

    /** Fades out from whatever it shows at [nowMs]. Does nothing once already fading out. */
    fun exit(nowMs: Long) {
        if (phase == Phase.OUT || isGone) return
        phase = Phase.OUT
        phaseStartMs = nowMs
        fadeFrom = lastFade
        ringFrom = lastRing
    }

    /** The overlay at [nowMs], or null once it has gone. */
    fun frame(nowMs: Long): SelectionOverlay? {
        if (isGone) return null
        val elapsed = (nowMs - phaseStartMs).toDouble()
        val fade: Double
        val ring: Double
        val open: Double
        when (phase) {
            Phase.IN -> {
                val p = min(1.0, elapsed / IN_MS)
                val e = 1 - (1 - p).pow(3)
                fade = fadeFrom + (SELECTION_FADE_MAX - fadeFrom) * e
                ring = ringFrom + (1 - ringFrom) * e
                open = e
                if (p >= 1) phase = Phase.HOLD
            }

            Phase.HOLD -> {
                fade = SELECTION_FADE_MAX
                ring = 1.0
                open = 1.0
            }

            Phase.OUT -> {
                val p = min(1.0, elapsed / OUT_MS)
                fade = fadeFrom * (1 - p)
                ring = ringFrom * (1 - p)
                // The holes close from fully open, whatever the fade had reached.
                open = 1 - p
                if (p >= 1) isGone = true
            }
        }
        lastFade = fade
        lastRing = ring
        return SelectionOverlay(
            point = point,
            label = label,
            color = color,
            fadeAlpha = fade,
            // Zeroed here rather than in the phases, so the bookkeeping stays the same for every
            // shape: only what's drawn differs.
            ringProgress = if (point.noRing) 0.0 else ring,
            openProgress = open,
        )
    }

    companion object {

        const val IN_MS = 350.0
        const val OUT_MS = 220.0
    }
}
