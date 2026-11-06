package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class MapDataTest {

    private fun manifest(version: String, build: String = "b-$version") = MapManifest(
        version = version,
        build = build,
        viewBox = listOf(0.0, 0.0, 100.0, 100.0),
        grid = MapManifest.Grid(1, 1),
        tileSize = MapManifest.TileSize(100.0, 100.0),
        raster = MapManifest.Raster("webp", listOf(1.0)),
    )

    private fun points(version: String, id: String = "KCI-MRI") =
        MapPoints(version, listOf(MapPoint(id = id, ax = 0.0, ay = 0.0, bx = 0.0, by = 0.0, r = 10.0)))

    private val bundledManifest = manifest("2026-08c")
    private val bundledPoints = points("2026-08c", "KCI-BUNDLED")
    private val bundledLabels = MapPoints("2026-08c", emptyList())

    @Test
    fun `with nothing deployed held, the bundled copies draw`() {
        val data = resolveMapData(null, null, null, bundledManifest, bundledPoints, bundledLabels)
        assertEquals(bundledManifest, data.manifest)
        assertEquals(bundledPoints.points, data.points)
    }

    @Test
    fun `deployed copies of the same edition win`() {
        val deployed = points("2026-09", "KCI-DEPLOYED")
        val data = resolveMapData(manifest("2026-09"), deployed, null, bundledManifest, bundledPoints, bundledLabels)
        assertEquals("2026-09", data.manifest.version)
        assertEquals(deployed.points, data.points)
    }

    @Test
    fun `tap targets an edition behind the tiles give way to a copy that matches`() {
        // A deploy moved the tiles to 2026-08c while the held tap targets are a stale 2026-08b.
        val stale = points("2026-08b", "KCI-STALE")
        val data = resolveMapData(manifest("2026-08c"), stale, null, bundledManifest, bundledPoints, bundledLabels)
        assertEquals(bundledPoints.points, data.points)
    }

    @Test
    fun `with no copy matching the tiles, the deployed one is the closer guess`() {
        val deployed = points("2026-09b", "KCI-DEPLOYED")
        val data = resolveMapData(manifest("2026-10"), deployed, null, bundledManifest, bundledPoints, bundledLabels)
        assertEquals(deployed.points, data.points)
    }

    @Test
    fun `a deployed manifest that can't be drawn is ignored`() {
        val broken = manifest("2026-09").copy(viewBox = emptyList())
        assertEquals(bundledManifest, resolveMapData(broken, null, null, bundledManifest, bundledPoints, bundledLabels).manifest)
    }

    private fun lines(version: String, key: String) = MapLines(
        version,
        listOf(MapLine(key, "KCI", key.substringAfter(':'), "Lin", "#000000", 12.5, emptyList())),
    )

    @Test
    fun `traced lines are taken from the copy traced on the tiles' edition`() {
        val stale = lines("2026-08b", "KCI:STALE")
        val bundled = lines("2026-08c", "KCI:BUNDLED")
        val data = resolveMapData(null, null, null, bundledManifest, bundledPoints, bundledLabels, stale, bundled)
        assertEquals("KCI:BUNDLED", data.lines.single().key)
    }

    @Test
    fun `with no traced lines held, nothing can be isolated`() {
        val data = resolveMapData(null, null, null, bundledManifest, bundledPoints, bundledLabels)
        assertEquals(emptyList<MapLine>(), data.lines)
    }

    @Test
    fun `the map opens on Manggarai when this edition draws it`() {
        val data = resolveMapData(null, points("2026-08c", "KCI-MRI"), null, bundledManifest, bundledPoints, bundledLabels)
        assertEquals("KCI-MRI", data.initialPoint?.id)
    }
}
