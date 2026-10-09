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

    @Test
    fun `decodes Google's own example polyline`() {
        val path = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")

        assertEquals(listOf(GeoPoint(38.5, -120.2), GeoPoint(40.7, -120.95), GeoPoint(43.252, -126.453)), path)
    }

    private fun GeoPoint.moved(northM: Double, eastM: Double) = GeoPoint(
        latitude + northM / M_PER_DEG,
        longitude + eastM / (M_PER_DEG * kotlin.math.cos(Math.toRadians(latitude))),
    )

    // An L: 1 km east, then 1 km north.
    private val start = GeoPoint(-6.2, 106.8)
    private val corner = start.moved(0.0, 1_000.0)
    private val ell = listOf(start, corner, corner.moved(1_000.0, 0.0))

    @Test
    fun `a point on a bent path is placed by the length run to it`() {
        // A quarter of the way up the second leg: 1,250 m of 2,000.
        val projection = projectOnPath(corner.moved(250.0, 0.0), ell)

        assertEquals(0.625, projection.fraction, 0.01)
        assertEquals(0.0, projection.offTrackM, 5.0)
    }

    @Test
    fun `a point off a bent path is measured from its nearest leg, not the chord`() {
        // Inside the L's corner: 100 m from the first leg, 150 m from the second, about 600 m from the chord.
        val projection = projectOnPath(corner.moved(100.0, -150.0), ell)

        assertEquals(100.0, projection.offTrackM, 5.0)
        assertEquals(0.425, projection.fraction, 0.01)
    }

    @Test
    fun `a path of one point is that point`() {
        val projection = projectOnPath(manggarai, listOf(sudirman))

        assertEquals(distanceM(manggarai, sudirman), projection.offTrackM, 15.0)
    }

    private companion object {
        const val M_PER_DEG = 111_195.0
    }
}
