package id.shiorilabs.commute.core.geo

import org.junit.Assert.assertEquals
import org.junit.Test

class GeoTest {

    private val sudirman = GeoPoint(-6.2024, 106.8237)
    private val manggarai = GeoPoint(-6.2099, 106.8502)

    @Test
    fun `distance between two stations matches the map`() {
        // About 3.06 km as the crow flies.
        assertEquals(3_055.0, distanceM(sudirman, manggarai), 30.0)
    }

    @Test
    fun `a point is no distance from itself`() {
        assertEquals(0.0, distanceM(sudirman, sudirman), 0.0)
    }

    @Test
    fun `the midpoint projects halfway and on track`() {
        val mid = GeoPoint((sudirman.latitude + manggarai.latitude) / 2, (sudirman.longitude + manggarai.longitude) / 2)

        val projection = project(mid, sudirman, manggarai)

        assertEquals(0.5, projection.fraction, 0.01)
        assertEquals(0.0, projection.offTrackM, 5.0)
    }

    @Test
    fun `a point past the end clamps to it and reports how far off it is`() {
        val beyond = GeoPoint(manggarai.latitude - 0.01, manggarai.longitude + 0.01)

        val projection = project(beyond, sudirman, manggarai)

        assertEquals(1.0, projection.fraction, 0.0)
        assertEquals(distanceM(beyond, manggarai), projection.offTrackM, 15.0)
    }

    @Test
    fun `a zero-length segment projects onto its one point`() {
        val projection = project(manggarai, sudirman, sudirman)

        assertEquals(0.0, projection.fraction, 0.0)
        assertEquals(distanceM(manggarai, sudirman), projection.offTrackM, 15.0)
    }
}
