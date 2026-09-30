package id.shiorilabs.commute.core.ui.icons

import androidx.compose.ui.graphics.vector.ImageVector
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Bold
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.bold.MagnifyingGlass
import com.adamglin.phosphoricons.fill.GearSix

/**
 * The single place UI icons are resolved. Reference `CommuteIcons.<SemanticName>` at call sites —
 * never `PhosphorIcons.*` directly — so the icon library stays swappable from one file.
 */
object CommuteIcons {

    val Search: ImageVector = PhosphorIcons.Bold.MagnifyingGlass
    val Settings: ImageVector = PhosphorIcons.Fill.GearSix
}
