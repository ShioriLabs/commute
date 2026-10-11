package id.shiorilabs.commute.shortcuts

import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.navigation.fareWebLink
import id.shiorilabs.commute.core.navigation.stationWebLink

/** The most pinned items the launcher menu shows; the OTW shortcut comes after them. */
internal const val MAX_SAVED_SHORTCUTS = 3

/** Pairs are held to this many while stations are there to fill the rest. */
private const val MAX_ROUTE_SHORTCUTS = 2

internal enum class ShortcutKind { Route, Station, Otw }

/** One launcher shortcut, before it is a `ShortcutInfoCompat`. [link] is a web link the app opens. */
internal data class ShortcutSpec(
    val id: String,
    val kind: ShortcutKind,
    val label: String,
    val link: String,
)

/**
 * The launcher menu in order: pinned pairs, then pinned stations, each in the rider's own order,
 * then OTW. At most [MAX_SAVED_SHORTCUTS] pinned items, and no more than two of them pairs unless
 * there are too few stations to take the rest. [names] holds station names by id; an entry whose
 * name isn't known is left out rather than shown as an id. [slots] is how many shortcuts the
 * launcher takes in all; OTW is always one of them, and the pinned items give way to it.
 */
internal fun buildShortcutSpecs(
    entries: List<SavedEntry>,
    names: Map<String, String>,
    otwLabel: String,
    slots: Int,
): List<ShortcutSpec> {
    if (slots <= 0) return emptyList()
    val savedSlots = minOf(MAX_SAVED_SHORTCUTS, (slots - 1).coerceAtLeast(0))
    val routes = entries.filterIsInstance<SavedEntry.Route>()
        .filter { it.fromId in names && it.toId in names }
    val stations = entries.filterIsInstance<SavedEntry.Station>()
        .filter { it.stationId in names }

    val routeCount = minOf(routes.size, maxOf(minOf(MAX_ROUTE_SHORTCUTS, savedSlots), savedSlots - stations.size))
    val stationCount = minOf(stations.size, savedSlots - routeCount)

    val specs = routes.take(routeCount).map { route ->
        ShortcutSpec(
            id = "route:${route.fromId}:${route.toId}",
            kind = ShortcutKind.Route,
            label = "${names.getValue(route.fromId)} → ${names.getValue(route.toId)}",
            link = fareWebLink(route.fromId, route.toId),
        )
    } + stations.take(stationCount).map { station ->
        ShortcutSpec(
            id = "station:${station.stationId}",
            kind = ShortcutKind.Station,
            label = names.getValue(station.stationId),
            link = stationWebLink(station.stationId),
        )
    }
    return specs + ShortcutSpec(id = "otw", kind = ShortcutKind.Otw, label = otwLabel, link = fareWebLink())
}
