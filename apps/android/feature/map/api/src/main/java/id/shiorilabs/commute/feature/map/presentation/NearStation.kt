package id.shiorilabs.commute.feature.map.presentation

/** A station near the rider, [distanceM] away as the crow flies: what home's map opens around. */
data class NearStation(val stationId: String, val distanceM: Int)
