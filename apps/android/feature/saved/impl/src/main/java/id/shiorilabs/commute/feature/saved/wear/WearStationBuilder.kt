package id.shiorilabs.commute.feature.saved.wear

import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.time.serviceStartMinute
import id.shiorilabs.commute.core.wearable.WearDay
import id.shiorilabs.commute.core.wearable.WearDirection
import id.shiorilabs.commute.core.wearable.WearStation
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import id.shiorilabs.commute.feature.station.domain.joinLabels
import java.time.Instant

/**
 * [station]'s boards as the watch takes them: one direction per line and board group, as the
 * phone's board groups them, with its departures on each kind of day in [boards] it runs.
 */
internal fun wearStation(
    station: Station,
    boards: Map<ServiceDayName, List<LineTimetable>>,
    lines: Map<String, LineInfo>,
    builtAt: Instant,
): WearStation {
    // Weekdays first, so a direction is named as the weekday board signs it.
    val days = ServiceDayName.entries.filter { it in boards }
    val firstSeen = LinkedHashMap<String, Pair<String, DirectionGroup>>()
    days.forEach { day ->
        boards.getValue(day).forEach { line ->
            line.groups.forEach { group -> firstSeen.putIfAbsent(keyOf(line.lineKey, group), line.lineKey to group) }
        }
    }
    val directions = firstSeen.map { (key, seen) ->
        val (lineKey, group) = seen
        WearDirection(
            key = key,
            lineKey = lineKey,
            lineName = lines[lineKey]?.name ?: codeOfLineKey(lineKey),
            color = lines[lineKey]?.colorCode?.let(::argbOf) ?: UNKNOWN_LINE,
            label = joinLabels(group.label),
            platform = group.platformCode,
            days = days.mapNotNull { day -> boards.getValue(day).dayOf(lineKey, group.key)?.let { day to it } }.toMap(),
        )
    }
    return WearStation(
        id = station.id,
        name = station.name,
        builtAt = builtAt.toEpochMilli(),
        directions = directions.filter { it.days.isNotEmpty() },
    )
}

/** The direction [groupKey] of [lineKey] on this board, or `null` where it doesn't run. */
private fun List<LineTimetable>.dayOf(lineKey: String, groupKey: String): WearDay? {
    val line = firstOrNull { it.lineKey == lineKey } ?: return null
    val group = line.groups.firstOrNull { it.key == groupKey } ?: return null
    val minutes = group.minutes().distinct().sorted()
    if (minutes.isEmpty()) return null
    // Over the whole line: a peak-only short-turn's own night falls at midday.
    return WearDay(start = serviceStartMinute(line.groups.flatMap { it.minutes() }), minutes = minutes)
}

private fun DirectionGroup.minutes(): List<Int> = destinations.flatMap { destination -> destination.departures.map { it.minute } }

private fun keyOf(lineKey: String, group: DirectionGroup) = "$lineKey|${group.key}"

/** `#RRGGBB` as opaque ARGB; `null` for a code that isn't one. */
private fun argbOf(code: String): Int? =
    code.removePrefix("#").takeIf { it.length == 6 }?.toLongOrNull(16)?.let { (0xFF000000 or it).toInt() }

/** Slate 500, for a line the dictionary doesn't know. */
private val UNKNOWN_LINE = 0xFF64748B.toInt()
