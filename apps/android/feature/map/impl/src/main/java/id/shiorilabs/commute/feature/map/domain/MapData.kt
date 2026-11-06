package id.shiorilabs.commute.feature.map.domain

/**
 * Everything the map draws and taps: an edition's tiles, the tap targets authored for it, and the
 * lines traced and corridors drawn on it, none when no copy is held.
 */
data class MapData(
    val manifest: MapManifest,
    val points: List<MapPoint>,
    val labels: List<MapPoint>,
    val lines: List<MapLine> = emptyList(),
    val corridors: MapCorridors? = null,
) {

    /** Where the map opens: [Viewport.INITIAL_STATION_ID]'s marker, when it's on this edition. */
    val initialPoint: MapPoint? get() = points.firstOrNull { it.id == Viewport.INITIAL_STATION_ID }
}

/**
 * The map to draw from the deployed copies held (any of them null when none is) and the copies the
 * app was built with.
 *
 * The deployed manifest wins when it's drawable. Tap targets are taken from whichever copy is
 * [usable][isUsableFor] for that manifest's edition, deployed first: a bad edit, or tap targets a
 * deploy has moved past, never break taps while a good copy exists. With none that matches, the
 * deployed copy that parsed is still closer than nothing, then the bundled one. The traced lines
 * and the corridors are taken the same way.
 */
fun resolveMapData(
    deployedManifest: MapManifest?,
    deployedPoints: MapPoints?,
    deployedLabels: MapPoints?,
    bundledManifest: MapManifest,
    bundledPoints: MapPoints,
    bundledLabels: MapPoints,
    deployedLines: MapLines? = null,
    bundledLines: MapLines? = null,
    deployedCorridors: MapCorridors? = null,
    bundledCorridors: MapCorridors? = null,
): MapData {
    val manifest = deployedManifest?.takeIf { it.isDrawable() } ?: bundledManifest
    fun pick(deployed: MapPoints?, bundled: MapPoints): MapPoints = listOfNotNull(deployed, bundled)
        .firstOrNull { it.isUsableFor(manifest.version) }
        ?: deployed?.takeIf { it.points.isNotEmpty() }
        ?: bundled
    return MapData(
        manifest = manifest,
        points = pick(deployedPoints, bundledPoints).points,
        labels = pick(deployedLabels, bundledLabels).points,
        lines = pickEdition(deployedLines, bundledLines, manifest.version, MapLines::version) { it.lines.isNotEmpty() }
            ?.lines.orEmpty(),
        corridors = pickEdition(deployedCorridors, bundledCorridors, manifest.version, MapCorridors::version) { it.corridors.isNotEmpty() },
    )
}

/** The copy of [edition], deployed first, else the deployed one that has anything, else the bundled. */
private fun <T : Any> pickEdition(deployed: T?, bundled: T?, edition: String, version: (T) -> String, filled: (T) -> Boolean): T? =
    listOfNotNull(deployed, bundled).firstOrNull { version(it) == edition && filled(it) }
        ?: deployed?.takeIf(filled)
        ?: bundled
