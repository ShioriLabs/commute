package id.shiorilabs.commute.core.ui.startup

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Whether the app's first frame may draw. The splash stays up while a screen holds the gate with
 * its first content still loading off disk, so the first thing a rider sees is the content rather
 * than its skeleton; the activity caps the wait, so a slow disk never holds the app past the
 * splash's own length.
 *
 * Only the first frame waits. Once it has drawn ([open]), holds no longer count: a skeleton later
 * on is the screen's own business. Main thread only, as composition and drawing both are.
 */
class StartupGate {

    private var holds = 0
    private var opened = false

    /** Whether nothing holds the first frame back, or it has already drawn. */
    val isOpen: Boolean get() = opened || holds == 0

    /** Holds the first frame back until the returned release is called; releasing twice counts once. */
    fun hold(): () -> Unit {
        if (opened) return {}
        holds++
        var released = false
        return {
            if (!released) {
                released = true
                holds--
            }
        }
    }

    /** The first frame is drawing: nothing holds it back from here on. */
    fun open() {
        opened = true
    }
}

/** The activity's [StartupGate]. Outside one (a preview, a test) a gate nothing ever waits on. */
val LocalStartupGate = staticCompositionLocalOf { StartupGate() }

/**
 * Holds the app's first frame back while [waiting]: a screen's first content still loading. Held
 * from the frame this is first composed in, before anything draws.
 */
@Composable
fun HoldStartupWhile(waiting: Boolean) {
    val gate = LocalStartupGate.current
    DisposableEffect(gate, waiting) {
        val release = if (waiting) gate.hold() else null
        onDispose { release?.invoke() }
    }
}
