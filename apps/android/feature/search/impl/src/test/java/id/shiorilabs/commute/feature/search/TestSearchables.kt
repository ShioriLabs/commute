package id.shiorilabs.commute.feature.search

import id.shiorilabs.commute.feature.search.domain.SearchLine
import id.shiorilabs.commute.feature.search.domain.Searchable

internal val lineBogor = SearchLine("Lin Bogor", "B", "#EE3D43", "KCI")
internal val lineCikarang = SearchLine("Lin Cikarang", "C", "#25B8EB", "KCI")

internal fun station(
    title: String,
    id: String,
    keywords: List<String> = listOf(title.lowercase()),
    score: Double? = null,
    operator: String = id.substringBefore('-'),
    lines: List<SearchLine> = listOf(lineBogor),
) = Searchable.Station(
    title = title,
    to = "/stations/${id.replace('-', '/')}",
    keywords = keywords,
    subtitle = null,
    score = score,
    stationId = id,
    operator = operator,
    lines = lines,
)

internal fun hub(title: String, slug: String, keywords: List<String> = listOf(title.lowercase())) =
    Searchable.Hub(
        title = title,
        to = "/hubs/$slug",
        keywords = keywords,
        subtitle = null,
        score = null,
        hubId = slug,
        lines = listOf(lineBogor, lineCikarang),
    )

internal fun line(title: String, searchLine: SearchLine = lineCikarang) = Searchable.Line(
    title = title,
    to = "/lines/${searchLine.operator}/${searchLine.lineCode}",
    keywords = listOf(title.lowercase()),
    subtitle = null,
    score = null,
    operator = searchLine.operator,
    line = searchLine,
)
