package id.shiorilabs.commute.core.ui.icons

import androidx.compose.ui.graphics.vector.ImageVector
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Bold
import com.adamglin.phosphoricons.Duotone
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.bold.ArrowBendDownRight
import com.adamglin.phosphoricons.bold.BellSimpleSlash
import com.adamglin.phosphoricons.bold.BellSimpleRinging
import com.adamglin.phosphoricons.bold.BellSimple
import com.adamglin.phosphoricons.bold.Alarm
import com.adamglin.phosphoricons.bold.ArrowRight
import com.adamglin.phosphoricons.bold.ArrowSquareOut
import com.adamglin.phosphoricons.bold.ArrowsDownUp
import com.adamglin.phosphoricons.bold.Bus
import com.adamglin.phosphoricons.bold.CaretDown
import com.adamglin.phosphoricons.bold.CaretLeft
import com.adamglin.phosphoricons.bold.CaretRight
import com.adamglin.phosphoricons.bold.CaretUp
import com.adamglin.phosphoricons.bold.Check
import com.adamglin.phosphoricons.bold.Clock
import com.adamglin.phosphoricons.bold.CreditCard
import com.adamglin.phosphoricons.bold.MagnifyingGlass
import com.adamglin.phosphoricons.bold.NavigationArrow
import com.adamglin.phosphoricons.bold.PencilSimple
import com.adamglin.phosphoricons.bold.PersonSimpleRun
import com.adamglin.phosphoricons.bold.PersonSimpleWalk
import com.adamglin.phosphoricons.bold.Prohibit
import com.adamglin.phosphoricons.bold.PushPin
import com.adamglin.phosphoricons.bold.PushPinSlash
import com.adamglin.phosphoricons.bold.ShareNetwork
import com.adamglin.phosphoricons.bold.SlidersHorizontal
import com.adamglin.phosphoricons.bold.TrainSimple
import com.adamglin.phosphoricons.bold.Wheelchair
import com.adamglin.phosphoricons.bold.X
import com.adamglin.phosphoricons.duotone.Baby
import com.adamglin.phosphoricons.duotone.Bicycle
import com.adamglin.phosphoricons.duotone.Broadcast
import com.adamglin.phosphoricons.duotone.Elevator
import com.adamglin.phosphoricons.duotone.EscalatorUp
import com.adamglin.phosphoricons.duotone.LetterCircleP
import com.adamglin.phosphoricons.duotone.Lockers
import com.adamglin.phosphoricons.duotone.MapPin
import com.adamglin.phosphoricons.duotone.Plug
import com.adamglin.phosphoricons.duotone.StarAndCrescent
import com.adamglin.phosphoricons.duotone.Toilet
import com.adamglin.phosphoricons.duotone.Warning
import com.adamglin.phosphoricons.fill.Airplane
import com.adamglin.phosphoricons.fill.Archive
import com.adamglin.phosphoricons.fill.CheckCircle
import com.adamglin.phosphoricons.fill.Database
import com.adamglin.phosphoricons.fill.Files
import com.adamglin.phosphoricons.fill.GearSix
import com.adamglin.phosphoricons.fill.HandHeart
import com.adamglin.phosphoricons.fill.Flask
import com.adamglin.phosphoricons.fill.Info
import com.adamglin.phosphoricons.fill.MapPin
import com.adamglin.phosphoricons.fill.PushPin
import com.adamglin.phosphoricons.fill.PushPinSimple
import com.adamglin.phosphoricons.fill.Ticket
import com.adamglin.phosphoricons.fill.Trash
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

    /** Opens the screen where pins are reordered. */
    val Edit: ImageVector = PhosphorIcons.Bold.PencilSimple

    /** Opens the debug frost tuner. */
    val Tune: ImageVector = PhosphorIcons.Bold.SlidersHorizontal

    /** Heads an amber notice: offline, or a station no train calls at any more. */
    val Warning: ImageVector = PhosphorIcons.Duotone.Warning

    /** Between a pair's two stations: Dari → Ke. */
    val ArrowRight: ImageVector = PhosphorIcons.Bold.ArrowRight

    /** A link that leaves the app. */
    val ExternalLink: ImageVector = PhosphorIcons.Bold.ArrowSquareOut

    /** Back one page; [Chevron] trails a row that opens another. */
    val Back: ImageVector = PhosphorIcons.Bold.CaretLeft
    val Chevron: ImageVector = PhosphorIcons.Bold.CaretRight

    /** A line's branch peeling off the way it isn't shown: tapping it shows that way instead. */
    val Branch: ImageVector = PhosphorIcons.Bold.ArrowBendDownRight

    /** Moves an entry one place up or down a list the rider orders. */
    val MoveUp: ImageVector = PhosphorIcons.Bold.CaretUp
    val MoveDown: ImageVector = PhosphorIcons.Bold.CaretDown

    /** Heading somewhere: the station page's "OTW Ke Sini". The web mirrors it to point right. */
    val NavigationArrow: ImageVector = PhosphorIcons.Bold.NavigationArrow

    /** A walk between stations, beside its distance. */
    val Walk: ImageVector = PhosphorIcons.Bold.PersonSimpleWalk

    /* OTW, as the web's fare sheet draws it. */

    /** Swaps the trip's two ends. */
    val Swap: ImageVector = PhosphorIcons.Bold.ArrowsDownUp

    /** The OTW panel before a pair is chosen. */
    val Pair: ImageVector = PhosphorIcons.Duotone.MapPin

    /** A paid corridor transfer. */
    val Ticket: ImageVector = PhosphorIcons.Fill.Ticket

    /** The settings chip: payment, which networks, walking speed, and when. */
    val Payment: ImageVector = PhosphorIcons.Bold.CreditCard
    val Bus: ImageVector = PhosphorIcons.Bold.Bus
    val Train: ImageVector = PhosphorIcons.Bold.TrainSimple
    val Check: ImageVector = PhosphorIcons.Bold.Check
    val Excluded: ImageVector = PhosphorIcons.Bold.Prohibit
    val Run: ImageVector = PhosphorIcons.Bold.PersonSimpleRun
    val Clock: ImageVector = PhosphorIcons.Bold.Clock

    /** A trip's reminders: "Tambah Pengingat", "Ingatkan Aku", "Bangunkan Aku", none. */
    val Reminder: ImageVector = PhosphorIcons.Bold.BellSimple
    val ReminderPing: ImageVector = PhosphorIcons.Bold.BellSimpleRinging
    val ReminderWake: ImageVector = PhosphorIcons.Bold.Alarm
    val ReminderNone: ImageVector = PhosphorIcons.Bold.BellSimpleSlash

    /** The chosen row in a single-choice list. */
    val Selected: ImageVector = PhosphorIcons.Fill.CheckCircle

    /** Clears stored data. */
    val Delete: ImageVector = PhosphorIcons.Fill.Trash
    val Share: ImageVector = PhosphorIcons.Bold.ShareNetwork

    /* The settings page's rows, as the web's settings sheet draws them. */
    val SavedStations: ImageVector = PhosphorIcons.Fill.PushPinSimple
    val ManageData: ImageVector = PhosphorIcons.Fill.Archive
    val Location: ImageVector = PhosphorIcons.Fill.MapPin
    val Legal: ImageVector = PhosphorIcons.Fill.Files
    val DataPlatform: ImageVector = PhosphorIcons.Fill.Database
    val Support: ImageVector = PhosphorIcons.Fill.HandHeart
    val About: ImageVector = PhosphorIcons.Fill.Info
    val Experimental: ImageVector = PhosphorIcons.Fill.Flask

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
