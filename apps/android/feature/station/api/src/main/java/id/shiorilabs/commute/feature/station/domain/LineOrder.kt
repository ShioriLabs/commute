package id.shiorilabs.commute.feature.station.domain

/*
 * How a station's lines and name are presented. Ports of the web's `app/utils/lines.ts` and
 * `utils/directional-stations.ts`; keep them in step.
 */

/**
 * Seasonal Pekan Raya Jakarta shuttles: they only run during the fair, so corridor lists hide them.
 * Display-only; the data stays.
 */
private val HIDDEN_TJ_CODES = setOf("PRJ2", "PRJ3")

private val TJ_CODE = Regex("^L?(\\d+)([A-Z]*)$")

/** A directional halte's suffix: "Kali Grogol Arah Utara". */
private val ARAH_SUFFIX = Regex("\\s+Arah\\s+(Utara|Selatan|Timur|Barat)$", RegexOption.IGNORE_CASE)

/**
 * [keys] (`TJ:6A`) in display order. TransJakarta corridors go by number, then letter (`6`, `6A`,
 * `13`, `L13E`), with the seasonal shuttles dropped; every other operator keeps the API's order.
 * Sorted on the keys rather than resolved lines, so the order holds while the dictionary loads.
 */
fun sortLineKeysForDisplay(keys: List<String>, operator: String?): List<String> {
    val present = keys.filter { it.isNotEmpty() }
    if (operator != OPERATOR_TJ) {
        return present
    }
    return present
        .filterNot { codeOfLineKey(it) in HIDDEN_TJ_CODES }
        .sortedWith { a, b -> compareTJLineCode(codeOfLineKey(a), codeOfLineKey(b)) }
}

/**
 * Corridor order: by number, then suffix. `L13E` (an express 13) sorts inside the 13 group, and
 * codes with no number, like `PRJ2`, go last.
 */
internal fun compareTJLineCode(a: String, b: String): Int {
    val (numberA, suffixA) = parseTJCode(a)
    val (numberB, suffixB) = parseTJCode(b)
    return when {
        numberA != numberB -> numberA.compareTo(numberB)
        suffixA != suffixB -> suffixA.compareTo(suffixB)
        // A stable tiebreak, e.g. `13E` against `L13E`.
        else -> a.compareTo(b)
    }
}

private fun parseTJCode(code: String): Pair<Int, String> {
    val match = TJ_CODE.matchEntire(code) ?: return Int.MAX_VALUE to code
    return match.groupValues[1].toInt() to match.groupValues[2]
}

/**
 * A directional halte's name without its "Arah …" suffix. The two halves of a split halte are one
 * stop to a rider, and search shows them as one.
 */
fun directionalBaseName(name: String): String = name.replace(ARAH_SUFFIX, "")
