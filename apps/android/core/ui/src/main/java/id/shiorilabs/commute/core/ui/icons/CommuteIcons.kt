package id.shiorilabs.commute.core.ui.icons

import androidx.compose.ui.graphics.vector.ImageVector
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Bold
import com.adamglin.phosphoricons.Duotone
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.bold.ArrowSquareOut
import com.adamglin.phosphoricons.bold.MagnifyingGlass
import com.adamglin.phosphoricons.bold.PushPin
import com.adamglin.phosphoricons.bold.PushPinSlash
import com.adamglin.phosphoricons.bold.Wheelchair
import com.adamglin.phosphoricons.bold.X
import com.adamglin.phosphoricons.duotone.Baby
import com.adamglin.phosphoricons.duotone.Bicycle
import com.adamglin.phosphoricons.duotone.Broadcast
import com.adamglin.phosphoricons.duotone.Elevator
import com.adamglin.phosphoricons.duotone.EscalatorUp
import com.adamglin.phosphoricons.duotone.LetterCircleP
import com.adamglin.phosphoricons.duotone.Lockers
import com.adamglin.phosphoricons.duotone.Plug
import com.adamglin.phosphoricons.duotone.StarAndCrescent
import com.adamglin.phosphoricons.duotone.Toilet
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

    /** Takes a pinned station off the home screen. */
    val Unpin: ImageVector = PhosphorIcons.Bold.PushPinSlash

    /** A link that leaves the app. */
    val ExternalLink: ImageVector = PhosphorIcons.Bold.ArrowSquareOut

    /** The Kalayang's roundel: an aircraft in place of a line code. */
    val Airplane: ImageVector = PhosphorIcons.Fill.Airplane

    /*
     * Station facilities, as the web's station page draws them. Both escalators share one glyph
     * and both lifts another: Jak Lingko's up and down escalator marks mean direction of travel,
     * not which side of the gates it is, and the label already says that.
     */
    val Toilet: ImageVector = PhosphorIcons.Duotone.Toilet

    /** Badged onto [Toilet] for the accessible one. */
    val Wheelchair: ImageVector = PhosphorIcons.Bold.Wheelchair
    val ChargingStation: ImageVector = PhosphorIcons.Duotone.Plug
    val Escalator: ImageVector = PhosphorIcons.Duotone.EscalatorUp
    val Elevator: ImageVector = PhosphorIcons.Duotone.Elevator
    val PrayingRoom: ImageVector = PhosphorIcons.Duotone.StarAndCrescent
    val Parking: ImageVector = PhosphorIcons.Duotone.LetterCircleP
    val Wifi: ImageVector = PhosphorIcons.Duotone.Broadcast
    val BikeParking: ImageVector = PhosphorIcons.Duotone.Bicycle
    val Lockers: ImageVector = PhosphorIcons.Duotone.Lockers
    val NursingRoom: ImageVector = PhosphorIcons.Duotone.Baby
}
