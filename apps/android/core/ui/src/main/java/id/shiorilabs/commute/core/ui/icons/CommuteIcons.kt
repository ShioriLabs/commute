package id.shiorilabs.commute.core.ui.icons

import androidx.compose.ui.graphics.vector.ImageVector
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Bold
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.bold.MagnifyingGlass
import com.adamglin.phosphoricons.bold.PushPin
import com.adamglin.phosphoricons.bold.X
import com.adamglin.phosphoricons.fill.Airplane
import com.adamglin.phosphoricons.fill.GearSix
import com.adamglin.phosphoricons.fill.PushPin
import com.adamglin.phosphoricons.fill.XCircle

/**
 * The single place UI icons are resolved. Reference `CommuteIcons.<SemanticName>` at call sites —
 * never `PhosphorIcons.*` directly — so the icon library stays swappable from one file.
 */
object CommuteIcons {

    val Search: ImageVector = PhosphorIcons.Bold.MagnifyingGlass
    val Settings: ImageVector = PhosphorIcons.Fill.GearSix
    val Close: ImageVector = PhosphorIcons.Bold.X

    /** Clears a text field. */
    val ClearField: ImageVector = PhosphorIcons.Fill.XCircle

    /** A station pinned to the home screen; [Pin] unpinned. */
    val Pinned: ImageVector = PhosphorIcons.Fill.PushPin
    val Pin: ImageVector = PhosphorIcons.Bold.PushPin

    /** The Kalayang's roundel: an aircraft in place of a line code. */
    val Airplane: ImageVector = PhosphorIcons.Fill.Airplane
}
