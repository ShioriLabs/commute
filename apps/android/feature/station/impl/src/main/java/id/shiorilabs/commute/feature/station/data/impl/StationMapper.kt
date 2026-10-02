package id.shiorilabs.commute.feature.station.data.impl

import id.shiorilabs.commute.core.model.models.ExternalTransfer
import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.HeadwayRowServiceHours
import id.shiorilabs.commute.core.model.models.InternalTransfer
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.feature.station.domain.Amenity
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.ServiceHours
import kotlin.math.roundToInt
import id.shiorilabs.commute.core.model.models.Station as StationDto
import id.shiorilabs.commute.core.model.models.Transfer as TransferDto
import id.shiorilabs.commute.feature.station.domain.Station as Station
import id.shiorilabs.commute.feature.station.domain.Transfer as Transfer

/**
 * A frequency row as the domain carries it. A day the app doesn't know is dropped rather than failing
 * the row; one left with no known day at all reads as every day, the API's own default.
 */
internal fun HeadwayRow.toFrequency() = Frequency(
    lineKey = line,
    headwaySeconds = headwayS,
    boundFor = boundFor,
    days = days
        ?.mapNotNull { day -> ServiceDayName.entries.firstOrNull { it.name == day } }
        ?.toSet()
        ?.takeIf { it.isNotEmpty() },
    serviceHours = serviceHours?.toServiceHours(),
)

/** The two shapes the generator folds into one class: a window, or all day. Anything else is unknown. */
private fun HeadwayRowServiceHours.toServiceHours(): ServiceHours? {
    if (allDay == true) {
        return ServiceHours.AllDay
    }
    val start = start ?: return null
    val end = end ?: return null
    return ServiceHours.Window(start, end)
}

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

/** A transfer as the domain carries it: the walk in whole metres, the station flattened in. */
internal fun TransferDto.toTransfer(): Transfer = when (this) {
    is InternalTransfer -> Transfer.Internal(
        id = id,
        distanceM = distanceM.roundToInt(),
        notes = notes,
        stationId = toStation.id,
        name = toStation.name,
        operator = toStation.`operator`,
        lineKeys = toStation.lines,
    )

    is ExternalTransfer -> Transfer.External(
        id = id,
        distanceM = distanceM.roundToInt(),
        notes = notes,
        name = toStation.name,
        operatorName = toStation.operatorName,
    )
}

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
