package id.shiorilabs.commute.core.ui.motion

import android.os.Build
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.requireGraphicsContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** How far a pressed surface shrinks. */
private const val PRESSED_SCALE = 0.97f

/** How soft a pressed surface goes: enough to read as pushed in, not enough to blur its text away. */
private val PressedBlur = 1.dp

/** Quick in, so the press is felt under the finger. */
private const val PRESS_MILLIS = 90

/** Slower out, so a tap shorter than the press still shows the whole dip. */
private const val RELEASE_MILLIS = 200

/**
 * The app's tap feedback, in place of Material's ripple: a pressed surface shrinks slightly and
 * goes a touch soft, then springs back on release. The web shows no highlight at all, but on a
 * phone a tap with no answer reads as a missed one.
 *
 * Provided as the theme's `LocalIndication`, so every `clickable` gets it. The blur needs Android
 * 12; below it the press only shrinks.
 */
data object PressFeedback : IndicationNodeFactory {

    override fun create(interactionSource: InteractionSource): DelegatableNode = PressFeedbackNode(interactionSource)
}

private class PressFeedbackNode(
    private val interactionSource: InteractionSource,
) : Modifier.Node(), DrawModifierNode {

    /** 0 at rest, 1 fully pressed. */
    private val progress = Animatable(0f)
    private var layer: GraphicsLayer? = null

    override fun onAttach() {
        layer = requireGraphicsContext().createGraphicsLayer()
        coroutineScope.launch {
            var press: Job? = null
            interactionSource.interactions.collect { interaction ->
                when (interaction) {
                    is PressInteraction.Press -> {
                        press = launch { progress.animateTo(1f, tween(PRESS_MILLIS)) }
                    }

                    is PressInteraction.Release, is PressInteraction.Cancel -> {
                        val pressing = press
                        launch {
                            // Let the dip finish first: a quick tap releases before it is visible.
                            pressing?.join()
                            progress.animateTo(0f, tween(RELEASE_MILLIS))
                        }
                    }
                }
            }
        }
    }

    override fun onDetach() {
        layer?.let { requireGraphicsContext().releaseGraphicsLayer(it) }
        layer = null
    }

    override fun ContentDrawScope.draw() {
        val pressed = progress.value
        val layer = layer
        if (pressed == 0f || layer == null) {
            drawContent()
            return
        }

        layer.record { this@draw.drawContent() }
        val scale = 1f - (1f - PRESSED_SCALE) * pressed
        layer.scaleX = scale
        layer.scaleY = scale
        layer.renderEffect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val radius = PressedBlur.toPx() * pressed
            BlurEffect(radius, radius, TileMode.Decal)
        } else {
            null
        }
        drawLayer(layer)
    }
}
