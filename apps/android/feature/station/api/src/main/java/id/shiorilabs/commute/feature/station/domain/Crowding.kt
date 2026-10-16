package id.shiorilabs.commute.feature.station.domain

/*
 * How crowded a station usually is, hour by hour. A forecast from schedules and published ridership,
 * never a live reading, so the copy says "biasanya" every time: an honestly labelled estimate
 * survives being wrong, a fake live one sends a rider trusting a green badge onto a packed platform.
 * Ports of the web's `components/density-badge`; keep them in step.
 */

/** The four levels, as the API numbers them. */
enum class CrowdLevel {
    LENGANG,
    RAMAI,
    PADAT,
    SANGAT_PADAT,
    ;

    companion object {

        /** The API's 0-3, clamped: a level from a newer model still lands on the scale. */
        fun of(level: Int): CrowdLevel = entries[level.coerceIn(0, entries.lastIndex)]
    }
}

/**
 * The model's estimate for one hour: a range, since it can't be sure. [min] equal to [max] means it
 * is; an open range is shown as both ends ("padat sampai sangat padat") rather than its top.
 */
data class CrowdRange(val min: CrowdLevel, val max: CrowdLevel) {

    val isSure: Boolean get() = min == max
}

/**
 * The station's 24 hours, from midnight. A null hour is one with no estimate (no service, or too
 * few trains to judge), which is NOT the same as quiet.
 */
data class CrowdForecast(val hours: List<CrowdRange?>) {

    /** The estimate for [hour] (0-23, Jakarta), or null when there is none. */
    fun at(hour: Int): CrowdRange? = hours.getOrNull(hour)

    companion object {

        /** No estimate for any hour: a TransJakarta halte, or a station the model doesn't cover. */
        val NONE = CrowdForecast(List(24) { null })
    }
}
