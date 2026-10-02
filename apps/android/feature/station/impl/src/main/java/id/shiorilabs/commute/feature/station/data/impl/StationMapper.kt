package id.shiorilabs.commute.feature.station.data.impl

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.core.model.models.Station as StationDto
import id.shiorilabs.commute.feature.station.domain.Station as Station

internal fun StationDto.toStation() = Station(
    id = id,
    name = name,
    operator = `operator`,
    code = code,
    lineKeys = lines,
    amenities = amenities.map { Amenity(type = it.type, text = it.text) },
    latitude = latitude,
    longitude = longitude,
)

/**
 * The board as the domain carries it, departures in minutes. A departure whose time doesn't parse is
 * dropped rather than failing the whole board.
 */
internal fun GroupedTimetable.toLineTimetable() = LineTimetable(
    lineKey = line,
    groups = timetable.map { group ->
        DirectionGroup(
            key = group.key,
            label = group.label,
            platformCode = group.platformCode,
            destinations = group.destinations.map { destination ->
                DestinationTimetable(
                    boundFor = destination.boundFor,
                    via = destination.via,
                    departures = destination.schedules.mapNotNull { schedule ->
                        parseMinute(schedule.estimatedDeparture)?.let { Departure(schedule.tripNumber, it) }
                    },
                )
            },
        )
    },
)

/** `HH:MM:SS` (or `HH:MM`) to minutes since midnight; seconds are dropped, as the boards do. */
internal fun parseMinute(time: String): Int? {
    val parts = time.split(':')
    val hours = parts.getOrNull(0)?.toIntOrNull() ?: return null
    val minutes = parts.getOrNull(1)?.toIntOrNull() ?: return null
    return hours * 60 + minutes
}

/** The line dictionary, keyed `OPERATOR:CODE` as every response refers to lines. */
internal fun List<OperatorWithLines>.toLineDictionary(): Map<String, LineInfo> =
    flatMap { operator ->
        operator.lines.map { line ->
            "${operator.code}:${line.lineCode}" to LineInfo(
                name = line.name,
                lineCode = line.lineCode,
                colorCode = line.colorCode,
                operator = operator.code,
            )
        }
    }.toMap()
