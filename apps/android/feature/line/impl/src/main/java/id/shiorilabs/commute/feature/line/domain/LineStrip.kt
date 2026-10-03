package id.shiorilabs.commute.feature.line.domain

/*
 * How a line's segments become the strip its page draws: a port of the web's
 * `app/components/line-strip/index.tsx` and `loop-section.tsx`. Keep them in step.
 */

/** How a station's node is drawn on the rail. */
enum class NodeKind {
    /** Either end of the strip: filled with the line's colour. */
    TERMINUS,

    /** Where branches part, or where the loop hangs off: filled, like a terminus. */
    JUNCTION,

    /** A stop the operator's other lines call at: outlined, with a shadow, its name in bold. */
    INTERCHANGE,

    /** Outlined. */
    REGULAR,
}

/** Which end of the rail a row carries, which stops at the node rather than running past it. */
enum class RailCap { START, END }

/** One row of the strip's single rail. */
sealed interface StripRow {

    data class Stop(val station: LineStop, val kind: NodeKind, val railCap: RailCap? = null) : StripRow

    /**
     * A branch not shown inline, peeling off the junction above it as an "arah [terminusName]" pill.
     * Tapping it shows that branch as the main line instead: [tailIndex] is what to activate.
     */
    data class Ramp(val tailIndex: Int, val terminusName: String) : StripRow
}

/**
 * A loop folded into two columns: down the left, round the bottom and back up the right, so stations
 * next to each other along the loop stay next to each other on screen. A row's right is null when
 * the loop has an odd count: its top right is plain rail running into the closure.
 */
data class LoopLayout(val rows: List<LoopRow>)

data class LoopRow(val left: LineStop, val right: LineStop?)

/** The strip: its [rows] down one rail, then the [loop] hanging off the last of them, if the line has one. */
data class LineStrip(
    val rows: List<StripRow>,
    val loop: LoopLayout? = null,
)

/**
 * [detail] as a strip, with the branch at [activeTail] drawn inline as the main line. Empty when the
 * line has no trunk to draw.
 *
 * A line with a loop is a lollipop (Cikarang): the trunk is the stick, ending at the junction the
 * loop hangs off, and any other branch is left out. Otherwise the branches leaving the trunk's end
 * are its tails (Bogor's continuation and the Nambo ramp): [activeTail] runs on inline, the rest
 * peel off the junction as ramps. One tail alone simply carries on, with no junction. A branch
 * joining anywhere else is left out, as on the web.
 */
fun lineStrip(detail: LineDetail, activeTail: Int = 0): LineStrip {
    val trunk = detail.segments.firstOrNull { it.kind == SegmentKind.TRUNK }
    if (trunk == null || trunk.stations.isEmpty()) {
        return LineStrip(rows = emptyList())
    }

    val loop = detail.segments.firstOrNull { it.kind == SegmentKind.LOOP }
    if (loop != null) {
        val stick = trunk.stations
        val rows = stick.mapIndexed { index, station ->
            StripRow.Stop(
                station = station,
                kind = when (index) {
                    0 -> NodeKind.TERMINUS
                    stick.lastIndex -> NodeKind.JUNCTION
                    else -> station.passingKind()
                },
                railCap = railCap(index, stick.lastIndex),
            )
        }
        return LineStrip(rows = rows, loop = foldLoop(loop.stations))
    }

    val trunkEnd = trunk.stations.last().code
    val tails = detail.segments.filter {
        (it.kind == SegmentKind.CONTINUATION || it.kind == SegmentKind.RAMP) && it.joinsAtCode == trunkEnd
    }
    val active = activeTailIndex(activeTail, tails.size)
    val main = trunk.stations + (active?.let { tails[it].stations }.orEmpty())
    val junction = trunkEnd.takeIf { tails.size > 1 }

    val rows = buildList {
        main.forEachIndexed { index, station ->
            val kind = when {
                station.code == junction -> NodeKind.JUNCTION
                index == 0 || index == main.lastIndex -> NodeKind.TERMINUS
                else -> station.passingKind()
            }
            add(StripRow.Stop(station, kind, railCap(index, main.lastIndex)))
            if (station.code == junction) {
                tails.forEachIndexed { tailIndex, tail ->
                    val terminus = tail.stations.lastOrNull()
                    if (tailIndex != active && terminus != null) {
                        add(StripRow.Ramp(tailIndex, terminus.name))
                    }
                }
            }
        }
    }
    return LineStrip(rows = rows)
}

/** The tail shown inline: [requested], kept within the [count] there are; null with none. */
private fun activeTailIndex(requested: Int, count: Int): Int? =
    if (count == 0) null else requested.coerceIn(0, count - 1)

private fun railCap(index: Int, lastIndex: Int): RailCap? = when (index) {
    0 -> RailCap.START
    lastIndex -> RailCap.END
    else -> null
}

private fun LineStop.passingKind(): NodeKind = if (isInterchange) NodeKind.INTERCHANGE else NodeKind.REGULAR

/**
 * Folds [stations] into two columns: the first half (rounded up) runs down the left, the rest back
 * up the right, so the loop's last station sits beside its first row, next to the closure.
 */
internal fun foldLoop(stations: List<LineStop>): LoopLayout {
    val leftCount = (stations.size + 1) / 2
    val rows = (0 until leftCount).map { row ->
        // Path index j sits on the right at row 2 * leftCount - 1 - j (0-based).
        LoopRow(left = stations[row], right = stations.getOrNull(2 * leftCount - 1 - row))
    }
    return LoopLayout(rows)
}

/**
 * A station number as its node stacks it, the line's prefix over the stop's position:
 * `C13` → (`C`, `13`). A TransJakarta number has no letter and splits at its hyphen: `13-4` →
 * (`13`, `4`). One with nothing to split is all position.
 */
fun splitStationNumber(stationNumber: String): Pair<String, String> {
    BRT_NUMBER.matchEntire(stationNumber)?.let { return it.groupValues[1] to it.groupValues[2] }
    val match = RAIL_NUMBER.matchEntire(stationNumber)
    if (match == null || match.groupValues[2].isEmpty()) {
        return "" to stationNumber
    }
    return match.groupValues[1] to match.groupValues[2]
}

private val BRT_NUMBER = Regex("^(\\d+)-(.+)$")
private val RAIL_NUMBER = Regex("^([A-Za-z]+)(.*)$")
