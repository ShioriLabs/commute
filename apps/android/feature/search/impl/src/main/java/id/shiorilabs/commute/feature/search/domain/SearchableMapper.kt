package id.shiorilabs.commute.feature.search.domain

import id.shiorilabs.commute.core.model.models.SearchableHub
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.SearchableLine
import id.shiorilabs.commute.core.model.models.SearchableLineEntry
import id.shiorilabs.commute.core.model.models.SearchableStation

/**
 * Resolves the index's line keys against its dictionary, as the web's `useSearchables` does.
 *
 * Keys are operator-qualified (`KCI:C`), so a hub spanning operators resolves unambiguously. A key
 * that misses is dropped from a station or hub, and a line entry whose own key misses is dropped
 * whole: every consumer may assume a line entry has its line.
 */
fun SearchableIndex.toSearchables(): List<Searchable> {
    fun resolve(key: String): SearchLine? = lines[key]?.toSearchLine()

    return items.mapNotNull { item ->
        when (item) {
            is SearchableStation -> Searchable.Station(
                title = item.title,
                to = item.to,
                keywords = item.keywords,
                subtitle = item.subtitle,
                score = item.score,
                stationId = item.`data`?.get("station-id"),
                operator = item.`operator`,
                lines = item.lineKeys.mapNotNull(::resolve),
            )

            is SearchableHub -> Searchable.Hub(
                title = item.title,
                to = item.to,
                keywords = item.keywords,
                subtitle = item.subtitle,
                score = item.score,
                hubId = item.`data`?.get("hub-id"),
                lines = item.lineKeys.mapNotNull(::resolve),
            )

            is SearchableLineEntry -> resolve(item.lineKey)?.let { line ->
                Searchable.Line(
                    title = item.title,
                    to = item.to,
                    keywords = item.keywords,
                    subtitle = item.subtitle,
                    score = item.score,
                    operator = item.`operator`,
                    line = line,
                )
            }
        }
    }
}

private fun SearchableLine.toSearchLine() = SearchLine(
    name = name,
    lineCode = lineCode,
    colorCode = colorCode,
    operator = `operator`,
)
