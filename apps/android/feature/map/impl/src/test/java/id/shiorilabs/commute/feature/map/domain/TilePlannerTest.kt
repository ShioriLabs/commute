package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TilePlannerTest {

    // The 2026-08c FDTJ edition's tiling.
    private val manifest = MapManifest(
        version = "2026-08c",
        build = "584909dc",
        viewBox = listOf(0.0, 0.0, 9513.57, 6726.88),
        grid = MapManifest.Grid(8, 8),
        tileSize = MapManifest.TileSize(1189.19625, 840.86),
        raster = MapManifest.Raster("webp", listOf(0.5, 1.0, 2.0)),
        preview = MapManifest.Preview("preview.webp", 1280, 905),
    )
    private val tiers = manifest.tiers

    @Test
    fun `the zoomed-out band is served from the half-res tier`() {
        assertEquals(0.5, pickTier(0.2, 2.0, 2.0, tiers), 0.0)
        assertEquals(0.5, pickTier(0.01, 2.0, 2.0, tiers), 0.0)
    }

    @Test
    fun `tiers step up a power of two past each boundary`() {
        assertEquals(1.0, pickTier(0.3, 2.0, 0.5, tiers), 0.0)
        assertEquals(2.0, pickTier(0.75, 2.0, 1.0, tiers), 0.0)
        // Never past the finest tier the build made.
        assertEquals(2.0, pickTier(1.5, 2.0, 2.0, tiers), 0.0)
    }

    @Test
    fun `a view resting just past a boundary doesn't upgrade`() {
        // 0.26 * 2 = 0.52: past 0.5, but within the 1.1x hysteresis.
        assertEquals(0.5, pickTier(0.26, 2.0, 0.5, tiers), 0.0)
        assertEquals(1.0, pickTier(0.3, 2.0, 0.5, tiers), 0.0)
        // Down is immediate.
        assertEquals(0.5, pickTier(0.2, 2.0, 1.0, tiers), 0.0)
    }

    @Test
    fun `the budget never drops below what is on screen`() {
        assertEquals(600L, tileBudgetBytes(6, 100, ceiling = 50))
        assertEquals(1200L, tileBudgetBytes(6, 100, ceiling = 10_000))
        assertEquals(1000L, tileBudgetBytes(6, 100, ceiling = 1000))
    }

    @Test
    fun `the first frame asks for the middle of the view first, two at a time, over the preview`() {
        val planner = TilePlanner<String>(manifest)
        val plan = planner.frame(Transform(tx = -1000.0, ty = -800.0, scale = 0.5), 400.0, 800.0, 2.0, nowMs = 0)
        assertTrue(plan.needsPreview)
        assertTrue(plan.draws.isEmpty())
        assertEquals(TilePlanner.MAX_CONCURRENT_LOADS, plan.starts.size)
        assertTrue(plan.starts.zipWithNext().all { (a, b) -> a.priority <= b.priority })
        assertEquals(1.0, plan.starts.first().tier, 0.0)
    }

    @Test
    fun `arrived pixels go up one a frame, and are drawn in the frame they go up in`() {
        val planner = TilePlanner<String>(manifest)
        val t = Transform(tx = -1000.0, ty = -800.0, scale = 0.5)
        val first = planner.frame(t, 400.0, 800.0, 2.0, nowMs = 0)
        first.starts.forEach { planner.fetched(it, "pixels ${it.tile}") }

        val second = planner.frame(t, 400.0, 800.0, 2.0, nowMs = 16)
        val uploaded = second.upload!!
        assertEquals("pixels ${uploaded.first.tile}", uploaded.second)
        assertTrue(second.draws.any { it.tile == uploaded.first.tile })
        assertTrue(second.hasReadyPixels)
    }

    @Test
    fun `pixels the view moved past are thrown away, not sent up`() {
        val discarded = mutableListOf<String>()
        val planner = TilePlanner<String>(manifest, discard = { discarded += it })
        val first = planner.frame(Transform(tx = 0.0, ty = 0.0, scale = 0.5), 400.0, 800.0, 2.0, nowMs = 0)
        first.starts.forEach { planner.fetched(it, "stale") }

        // Panned to the far corner: the tiles asked for are off screen.
        val far = Transform(tx = -(9513.57 * 0.5 - 400), ty = -(6726.88 * 0.5 - 800), scale = 0.5)
        val plan = planner.frame(far, 400.0, 800.0, 2.0, nowMs = 16)
        assertNull(plan.upload)
        assertEquals(first.starts.size, discarded.size)
    }

    @Test
    fun `a failed tile isn't asked for again until it's due`() {
        val planner = TilePlanner<String>(manifest)
        val t = Transform(tx = -1000.0, ty = -800.0, scale = 0.5)
        val first = planner.frame(t, 400.0, 800.0, 2.0, nowMs = 0)
        val failed = first.starts.first()
        first.starts.forEach { planner.failed(it, nowMs = 0) }

        val soon = planner.frame(t, 400.0, 800.0, 2.0, nowMs = 1_000)
        assertFalse(soon.starts.any { it.tile == failed.tile })
        // What started meanwhile lands, so the retry has a fetch slot.
        soon.starts.forEach { planner.fetched(it, "pixels") }
        val later = planner.frame(t, 400.0, 800.0, 2.0, nowMs = TilePlanner.RETRY_AFTER_MS + 1)
        assertTrue(later.starts.any { it.tile == failed.tile })
    }

    @Test
    fun `off-screen tiles held finer than the view asks for are let go, on-screen ones never`() {
        val planner = TilePlanner<String>(manifest)
        val zoomedIn = Transform(tx = -1000.0, ty = -800.0, scale = 1.5)
        loadEverything(planner, zoomedIn)
        val held = planner.residentBytes
        assertTrue(held > 0)

        // Zoomed out over the same corner: the 2x tiles under the view stay, the rest go.
        val zoomedOut = Transform(tx = 0.0, ty = 0.0, scale = 0.2)
        val plan = planner.frame(zoomedOut, 400.0, 800.0, 2.0, nowMs = 10_000)
        val onScreen = plan.draws.map { it.tile }.toSet()
        assertTrue(plan.releases.none { it in onScreen })
    }

    @Test
    fun `letting go of the surface forgets every texture`() {
        val planner = TilePlanner<String>(manifest)
        val t = Transform(tx = -1000.0, ty = -800.0, scale = 0.5)
        loadEverything(planner, t)
        assertTrue(planner.releaseAll().isNotEmpty())
        assertEquals(0L, planner.residentBytes)
        assertTrue(planner.frame(t, 400.0, 800.0, 2.0, nowMs = 20_000).needsPreview)
    }

    /** Frames [t] until every tile it shows has arrived and gone up. */
    private fun loadEverything(planner: TilePlanner<String>, t: Transform) {
        repeat(64) { frame ->
            val plan = planner.frame(t, 400.0, 800.0, 2.0, nowMs = frame * 16L)
            plan.starts.forEach { planner.fetched(it, "pixels") }
        }
    }
}
