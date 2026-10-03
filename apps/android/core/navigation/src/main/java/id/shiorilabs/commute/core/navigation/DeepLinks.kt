package id.shiorilabs.commute.core.navigation

import java.net.URI
import java.net.URLDecoder

/** The `Charset` overloads of URLDecoder need API 33; the name works everywhere. */
private const val UTF_8 = "UTF-8"

/** The web app's host: a link to it the app can show opens here instead. */
private const val WEB_HOST = "commute.shiorilabs.id"

/**
 * The screen a web link opens, or `null` for one the app has no screen for (the browser keeps
 * those): `/fare`, a shared OTW link with its pair, settings and journey, and a station's page or
 * its full timetable.
 */
fun routeForLink(link: String): Route? {
    val uri = runCatching { URI(link) }.getOrNull() ?: return null
    if (uri.scheme != "https" || uri.host != WEB_HOST) {
        return null
    }
    val path = uri.path?.trimEnd('/')
    if (path?.startsWith("/stations/") == true) {
        return stationRoute(path)
    }
    return when (path) {
        "/fare" -> {
            val params = queryParams(uri.rawQuery)
            Route.Journey(
                fromId = params["from"]?.ifEmpty { null },
                toId = params["to"]?.ifEmpty { null },
                journeyKey = params["j"]?.ifEmpty { null },
                boardingClock = params["jt"]?.ifEmpty { null },
                paymentMethod = params["paymentMethod"],
                at = params["at"],
                modes = params["modes"],
                walking = params["walking"],
            )
        }

        else -> null
    }
}

/**
 * `/stations/KCI/MRI` and `/stations/KCI/MRI/timetable`. The web doesn't normalise the case of
 * either half, so a hand-typed `/stations/kci/mri` works there; the id it names is upper case.
 */
private fun stationRoute(path: String): Route? {
    val segments = path.removePrefix("/stations/").split('/')
    val (operator, code) = segments.takeIf { it.size in 2..3 && it[0].isNotEmpty() && it[1].isNotEmpty() }
        ?: return null
    val stationId = "${operator.uppercase()}-${code.uppercase()}"
    return when (segments.getOrNull(2)) {
        null -> Route.Station(stationId)
        "timetable" -> Route.StationTimetable(stationId)
        else -> null
    }
}

/** The first value of each query param, decoded. */
private fun queryParams(rawQuery: String?): Map<String, String> {
    if (rawQuery.isNullOrEmpty()) {
        return emptyMap()
    }
    return rawQuery.split('&')
        .filter { it.isNotEmpty() }
        .map { pair ->
            val key = pair.substringBefore('=')
            val value = pair.substringAfter('=', "")
            URLDecoder.decode(key, UTF_8) to URLDecoder.decode(value, UTF_8)
        }
        .distinctBy { it.first }
        .toMap()
}
