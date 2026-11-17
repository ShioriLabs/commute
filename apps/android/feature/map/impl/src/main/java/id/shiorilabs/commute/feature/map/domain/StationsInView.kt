package id.shiorilabs.commute.feature.map.domain

import kotlin.math.hypot

/**
 * The stations whose markers [camera] shows in [view], above the sheet covering its foot, nearest
 * the middle of what shows first, [limit] at most: what "Sekitar" lists for a panned map. Hubs and
 * station names aren't markers; a station drawn twice counts once, where it's nearer.
 */
fun stationsInView(points: List<MapPoint>, camera: Transform, view: Viewport, limit: Int): List<String> {
    val shownHeight = view.height - view.insetBottom.coerceIn(0.0, view.height)
    val middleX = view.width / 2
    val middleY = shownHeight / 2
    return points.asSequence()
        .filter { !it.isHub && !it.isLabel }
        .mapNotNull { point ->
            val x = point.centerX * camera.scale + camera.tx
            val y = point.centerY * camera.scale + camera.ty
            if (x < 0 || x > view.width || y < 0 || y > shownHeight) null else point.stationId to hypot(x - middleX, y - middleY)
        }
        .sortedBy { it.second }
        .map { it.first }
        .distinct()
        .take(limit)
        .toList()
}
