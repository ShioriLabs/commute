package id.shiorilabs.commute.core.ui.components

/*
 * Station numbers are drawn as the line's prefix stacked over the stop's position, the way the FDTJ
 * map prints them. A port of the web's `utils/station-number.ts`; keep them in step.
 */

/**
 * A station number as a roundel stacks it, the line's prefix over the stop's position:
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
