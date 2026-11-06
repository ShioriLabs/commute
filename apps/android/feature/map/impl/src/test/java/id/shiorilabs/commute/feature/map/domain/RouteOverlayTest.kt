package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The web's `map-route-overlay.test.ts`, where a journey's station ids meet the map's shapes. Ids
 * missing from the points are normal (TransJakarta stops the schematic doesn't draw), so chording
 * across them is load-bearing.
 */
class RouteOverlayTest {

    /** A point whose centroid is exactly ([x], [y]). */
    private fun pt(id: String, x: Double, y: Double, station: String? = null) =
        MapPoint(id = id, station = station, ax = x - 10, ay = y, bx = x + 10, by = y, r = 5.0)

    private fun raw(id: String, ax: Double, ay: Double, bx: Double, by: Double) = MapPoint(id = id, ax = ax, ay = ay, bx = bx, by = by, r = 12.0)

    private val lineColors = HashMap<String, String>()

    /** A ride on a line of its own, drawn in [color]. */
    private fun ride(vararg stopIds: String, color: String = "#FF0000"): RouteLeg.Ride {
        val line = "KCI:L${lineColors.size}"
        lineColors[line] = color
        return RouteLeg.Ride(line, "KCI", stopIds.toList())
    }

    private fun walk(fromId: String, toId: String) = RouteLeg.Walk(fromId, toId)

    private fun build(
        legs: List<RouteLeg>,
        from: String?,
        to: String?,
        points: List<MapPoint>,
        corridors: List<MapCorridor> = emptyList(),
        linePaths: PreparedLinePaths? = null,
        connectors: List<List<WorldPoint>> = emptyList(),
        lineColor: (String) -> String? = { lineColors[it] },
    ) = buildRouteOverlayModel(legs, from, to, points, lineColor, prepareCorridors(corridors), linePaths, connectors)

    private fun corridor(vararg pts: Pair<Double, Double>, w: Double = 25.0, c: String = "#00BDEE") =
        MapCorridor(w, c, pts.map { listOf(it.first, it.second) })

    private val RouteOverlayModel.rideSegments get() = overlay.segments.filter { it.kind == RouteSegmentKind.RIDE }
    private val RouteOverlayModel.walkDots get() = overlay.segments.filter { it.kind == RouteSegmentKind.TRANSFER }
    private val RouteOverlayModel.stops get() = overlay.pins.filter { it.kind == RoutePinKind.STOP }

    private fun RouteSegment.assertRuns(ax: Double, ay: Double, bx: Double, by: Double) {
        assertEquals(listOf(ax, ay, bx, by), listOf(this.ax, this.ay, this.bx, this.by))
    }

    private val red = Rgb(1.0, 0.0, 0.0)

    @Test
    fun `nothing resolving against the points draws nothing`() {
        assertNull(build(emptyList(), "KCI-XXX", "KCI-YYY", listOf(pt("KCI-AAA", 0.0, 0.0))))
    }

    @Test
    fun `before the fare, the pair alone draws its pins`() {
        val model = build(emptyList(), "KCI-AAA", "KCI-BBB", listOf(pt("KCI-AAA", 100.0, 200.0), pt("KCI-BBB", 300.0, 400.0)))!!
        assertTrue(model.overlay.segments.isEmpty())
        assertEquals(
            listOf(RoutePin(100.0, 200.0, RoutePinKind.ORIGIN), RoutePin(300.0, 400.0, RoutePinKind.DESTINATION)),
            model.overlay.pins,
        )
        assertEquals(
            RouteBounds(100 - ROUTE_PIN_RADIUS_WORLD, 200 - ROUTE_PIN_RADIUS_WORLD, 300 + ROUTE_PIN_RADIUS_WORLD, 400 + ROUTE_PIN_RADIUS_WORLD),
            model.bounds,
        )
    }

    @Test
    fun `one end set draws one pin`() {
        val model = build(emptyList(), "KCI-AAA", null, listOf(pt("KCI-AAA", 100.0, 200.0)))!!
        assertEquals(listOf(RoutePin(100.0, 200.0, RoutePinKind.ORIGIN)), model.overlay.pins)
    }

    private val line3 = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-MID", 100.0, 0.0), pt("KCI-BBB", 200.0, 0.0))

    @Test
    fun `a different journey of the same pair draws differently`() {
        assertEquals(2, build(listOf(ride("KCI-AAA", "KCI-MID", "KCI-BBB")), "KCI-AAA", "KCI-BBB", line3)!!.overlay.segments.size)
        assertEquals(1, build(listOf(ride("KCI-AAA", "KCI-BBB")), "KCI-AAA", "KCI-BBB", line3)!!.overlay.segments.size)
    }

    @Test
    fun `the pins mark the journey's real ends, not the pair asked for`() {
        // A journey asked for LRT Rasuna Said ending at the TJ halte on top of it.
        val points = listOf(pt("TJ-AAA", 0.0, 0.0), pt("TJ-RAS", 100.0, 0.0), pt("LRT-RAS", 100.0, 40.0))
        val model = build(listOf(ride("TJ-AAA", "TJ-RAS")), "TJ-AAA", "LRT-RAS", points)!!
        val destination = model.overlay.pins.single { it.kind == RoutePinKind.DESTINATION }
        assertEquals(100.0 to 0.0, destination.x to destination.y)
    }

    @Test
    fun `a ride is solid segments through its stops' centroids`() {
        val segments = build(listOf(ride("KCI-AAA", "KCI-MID", "KCI-BBB")), "KCI-AAA", "KCI-BBB", line3)!!.overlay.segments
        assertEquals(2, segments.size)
        segments[0].assertRuns(0.0, 0.0, 100.0, 0.0)
        assertEquals(RouteSegmentKind.RIDE, segments[0].kind)
        assertEquals(red, segments[0].color)
        segments[1].assertRuns(100.0, 0.0, 200.0, 0.0)
    }

    @Test
    fun `stops missing from the points are chorded across`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 0.0))
        val model = build(listOf(ride("KCI-AAA", "TJ-GONE1", "TJ-GONE2", "KCI-BBB")), "KCI-AAA", "KCI-BBB", points)!!
        assertEquals(1, model.overlay.segments.size)
        model.overlay.segments[0].assertRuns(0.0, 0.0, 200.0, 0.0)
    }

    @Test
    fun `a ride none of whose stops are drawn leaves just the pins`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 0.0))
        val model = build(listOf(ride("TJ-GONE1", "TJ-GONE2")), "KCI-AAA", "KCI-BBB", points)!!
        assertTrue(model.overlay.segments.isEmpty())
        assertEquals(2, model.overlay.pins.size)
    }

    private val inLine = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 100.0, 0.0), pt("MRT-CCC", 200.0, 0.0), pt("MRT-DDD", 300.0, 0.0))

    @Test
    fun `a walk is dots, from one station to the next`() {
        val legs = listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD", color = "#0000FF"))
        val model = build(legs, "KCI-AAA", "MRT-DDD", inLine)!!
        val dots = model.walkDots
        assertTrue(dots.size > 2)
        for (dot in dots) assertTrue(dot.ax == dot.bx && dot.ay == dot.by)
        assertEquals(100.0, dots.first().ax, 0.0)
        assertEquals(200.0, dots.last().ax, 1e-6)
        assertEquals(2, model.rideSegments.size)
    }

    @Test
    fun `a journey that opens on foot walks from its origin`() {
        val legs = listOf(walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD"))
        val dots = build(legs, "KCI-BBB", "MRT-DDD", inLine)!!.walkDots
        assertTrue(dots.size > 2)
        assertEquals(100.0, dots.first().ax, 1e-6)
        assertEquals(200.0, dots.last().ax, 1e-6)
    }

    @Test
    fun `rides abutting at different stations are bridged by a walk`() {
        val dots = build(listOf(ride("KCI-AAA", "KCI-BBB"), ride("MRT-CCC", "MRT-DDD")), "KCI-AAA", "MRT-DDD", inLine)!!.walkDots
        assertTrue(dots.isNotEmpty())
        assertTrue(dots.first().ax >= 100)
        assertTrue(dots.last().bx <= 200)
    }

    @Test
    fun `an offset walk goes diagonal, then straight into the next stop`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 100.0, 0.0), pt("MRT-CCC", 300.0, 60.0), pt("MRT-DDD", 400.0, 60.0))
        val legs = listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD"))
        val dots = build(legs, "KCI-AAA", "MRT-DDD", points)!!.walkDots
        assertTrue(dots.size > 2)
        // The corner at (160, 60), rounded either side.
        for (dot in dots) {
            when {
                dot.ax < 140 -> assertEquals(dot.ax - 100, dot.ay, 1e-6)
                dot.ax > 185 -> assertEquals(60.0, dot.ay, 1e-6)
                else -> assertTrue(dot.ay > 38)
            }
            assertTrue(dot.ay <= 60 + 1e-6)
        }
        assertTrue(dots.any { it.ay > 0 && it.ay < 60 })
        assertTrue(dots.any { it.ax > 160 && it.ax < 300 })
    }

    @Test
    fun `a near-aligned walk nothing crowds stays straight`() {
        // Sudirman-shaped: the next ride leaves sideways, clear of the walk.
        val points = listOf(pt("KCI-AAA", -300.0, 0.0), pt("KCI-BBB", 0.0, 0.0), pt("MRT-CCC", 0.0, 270.0), pt("MRT-DDD", 300.0, 270.0))
        val legs = listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD"))
        for (dot in build(legs, "KCI-AAA", "MRT-DDD", points)!!.walkDots) assertEquals(0.0, dot.ax, 1e-6)
    }

    // Manggarai-shaped: the line leaving C climbs alongside the straight walk.
    private val manggarai = listOf(pt("KCI-AAA", -300.0, 0.0), pt("KCI-BBB", 0.0, 0.0), pt("MRT-CCC", 5.0, 200.0), pt("MRT-DDD", 35.0, 0.0))

    @Test
    fun `a crowded near-aligned walk bulges to the side clear of the rides`() {
        val legs = listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD"))
        val dots = build(legs, "KCI-AAA", "MRT-DDD", manggarai)!!.walkDots
        assertTrue(dots.minOf { it.ax } < -30)
        assertTrue(dots.maxOf { it.ax } <= 5 + 1e-6)
    }

    @Test
    fun `a walk bulges the same way in both directions`() {
        val forward = build(
            listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD")), "KCI-AAA", "MRT-DDD", manggarai,
        )!!.walkDots
        val backward = build(
            listOf(ride("MRT-DDD", "MRT-CCC"), walk("MRT-CCC", "KCI-BBB"), ride("KCI-BBB", "KCI-AAA")), "MRT-DDD", "KCI-AAA", manggarai,
        )!!.walkDots.reversed()
        assertEquals(forward.size, backward.size)
        forward.zip(backward).forEach { (f, b) ->
            assertEquals(f.ax, b.ax, 1e-6)
            assertEquals(f.ay, b.ay, 1e-6)
        }
    }

    // B at (0, 0), C at (0, 200): the connector bulges out to x = -60 and runs on past C.
    private val connectorPoints = listOf(pt("KCI-AAA", -300.0, 0.0), pt("KCI-BBB", 0.0, 0.0), pt("MRT-CCC", 0.0, 200.0), pt("MRT-DDD", 300.0, 200.0))
    private val connector = listOf(WorldPoint(0.0, 15.0), WorldPoint(-60.0, 75.0), WorldPoint(-60.0, 125.0), WorldPoint(0.0, 185.0), WorldPoint(0.0, 240.0))
    private fun connectorLegs() = listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD"))

    @Test
    fun `a walk follows the connector drawn between its stations, and stops where it ends`() {
        val dots = build(connectorLegs(), "KCI-AAA", "MRT-DDD", connectorPoints, connectors = listOf(connector))!!.walkDots
        assertTrue(dots.minOf { it.ax } < -45)
        assertTrue(dots.minOf { it.ax } >= -60 - 1e-6)
        assertTrue(dots.maxOf { it.ay } <= 200 + 1e-6)
        assertEquals(200.0, dots.last().ay, 1e-6)
    }

    @Test
    fun `a connector walk is the same line in both directions`() {
        val forward = build(connectorLegs(), "KCI-AAA", "MRT-DDD", connectorPoints, connectors = listOf(connector))!!.walkDots
        val back = listOf(ride("MRT-DDD", "MRT-CCC"), walk("MRT-CCC", "KCI-BBB"), ride("KCI-BBB", "KCI-AAA"))
        val backward = build(back, "MRT-DDD", "KCI-AAA", connectorPoints, connectors = listOf(connector))!!.walkDots.reversed()
        assertEquals(forward.size, backward.size)
        forward.zip(backward).forEach { (f, b) ->
            assertEquals(f.ax, b.ax, 1e-6)
            assertEquals(f.ay, b.ay, 1e-6)
        }
    }

    @Test
    fun `a connector not joining both stations is ignored`() {
        val elsewhere = listOf(WorldPoint(0.0, 15.0), WorldPoint(-60.0, 75.0), WorldPoint(-500.0, 75.0))
        for (dot in build(connectorLegs(), "KCI-AAA", "MRT-DDD", connectorPoints, connectors = listOf(elsewhere))!!.walkDots) {
            assertEquals(0.0, dot.ax, 1e-6)
        }
    }

    @Test
    fun `an exact point id beats a station's alias`() {
        val points = listOf(pt("TJ-H00037C-b", 500.0, 500.0, "TJ-H00037C"), pt("TJ-H00037C", 100.0, 100.0))
        assertEquals(listOf(RoutePin(100.0, 100.0, RoutePinKind.ORIGIN)), build(emptyList(), "TJ-H00037C", null, points)!!.overlay.pins)
    }

    @Test
    fun `each stop between gets a dot in the ridden line's colour`() {
        val model = build(listOf(ride("KCI-AAA", "KCI-MID", "KCI-BBB")), "KCI-AAA", "KCI-BBB", line3)!!
        assertEquals(listOf(RoutePin(100.0, 0.0, RoutePinKind.STOP, red, ROUTE_STOP_RADIUS_WORLD)), model.stops)
    }

    @Test
    fun `the journey's ends are left to their pins`() {
        val model = build(listOf(ride("KCI-AAA", "KCI-BBB")), "KCI-AAA", "KCI-BBB", listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 0.0)))!!
        assertTrue(model.stops.isEmpty())
        assertEquals(listOf(RoutePinKind.ORIGIN, RoutePinKind.DESTINATION), model.overlay.pins.map { it.kind })
    }

    @Test
    fun `an interchange gets one dot, the arriving line's`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-XCH", 100.0, 0.0), pt("MRT-BBB", 200.0, 0.0))
        val model = build(listOf(ride("KCI-AAA", "KCI-XCH"), ride("KCI-XCH", "MRT-BBB", color = "#0000FF")), "KCI-AAA", "MRT-BBB", points)!!
        assertEquals(red, model.stops.single().color)
    }

    @Test
    fun `the bounds pad a stop by its dot, not a pin`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-MID", 100.0, 500.0), pt("KCI-BBB", 200.0, 0.0))
        val model = build(listOf(ride("KCI-AAA", "KCI-MID", "KCI-BBB")), "KCI-AAA", "KCI-BBB", points)!!
        assertEquals(500 + ROUTE_STOP_RADIUS_WORLD, model.bounds.maxY, 0.0)
    }

    // Two haltes on the stroke, two authored as bars whose centroid sits 11 above it, and a stop
    // past the bend so the leg keeps corridor shape.
    private val snappingStroke = corridor(0.0 to 0.0, 400.0 to 0.0, 520.0 to 90.0, 640.0 to 90.0, w = 15.0, c = "#F9C535")
    private val snappingPoints = listOf(
        raw("TJ-A", 0.0, 0.0, 0.0, 0.0),
        raw("TJ-B", 130.0, -22.0, 130.0, 0.0),
        raw("TJ-C", 260.0, -22.0, 260.0, 0.0),
        raw("TJ-D", 400.0, 0.0, 400.0, 0.0),
        raw("TJ-E", 640.0, 90.0, 640.0, 90.0),
    )
    private val koridor3 = listOf(RouteLeg.Ride("TJ:3", "TJ", listOf("TJ-A", "TJ-B", "TJ-C", "TJ-D", "TJ-E")))

    @Test
    fun `a chorded pair still runs on its corridor, its dots on the line`() {
        val model = build(koridor3, "TJ-A", "TJ-E", snappingPoints, listOf(snappingStroke), lineColor = { "#FDCB1C" })!!
        val beforeBend = model.rideSegments.filter { it.ax < 400 && it.bx <= 400 }
        assertTrue(beforeBend.isNotEmpty())
        for (s in beforeBend) assertTrue(abs(s.ay) < 3 && abs(s.by) < 3)
        val dots = model.stops.filter { it.x < 400 }
        assertTrue(dots.isNotEmpty())
        for (dot in dots) assertTrue(abs(dot.y) < 3)
    }

    private val gatePoints = listOf(raw("TJ-A", 0.0, 6.0, 0.0, 6.0), raw("TJ-B", 200.0, 6.0, 200.0, 6.0))
    private val gateLeg = listOf(RouteLeg.Ride("TJ:3", "TJ", listOf("TJ-A", "TJ-B")))
    private val yellowStroke = corridor(0.0 to 0.0, 200.0 to 0.0, w = 15.0, c = "#F9C535")
    private val blueStub = corridor(0.0 to 8.0, 200.0 to 8.0, w = 15.0, c = "#2455A3")

    @Test
    fun `a leg rides its own stroke, not a nearer one of another colour`() {
        val rides = build(gateLeg, "TJ-A", "TJ-B", gatePoints, listOf(blueStub, yellowStroke), lineColor = { "#FDCB1C" })!!.rideSegments
        assertTrue(rides.isNotEmpty())
        for (s in rides) assertTrue(abs(s.ay) < 4)
    }

    @Test
    fun `with no stroke of its colour, a leg still draws`() {
        assertTrue(build(gateLeg, "TJ-A", "TJ-B", gatePoints, listOf(blueStub), lineColor = { "#FDCB1C" })!!.rideSegments.isNotEmpty())
    }

    // An L, stations at its ends: a chord cuts the diagonal, the corridor turns.
    private val lCorridor = listOf(corridor(0.0 to 0.0, 200.0 to 0.0, 200.0 to 200.0))
    private val lEnds = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 200.0))

    @Test
    fun `a ride follows its corridor round a corner`() {
        val model = build(listOf(ride("KCI-AAA", "KCI-BBB")), "KCI-AAA", "KCI-BBB", lEnds, lCorridor)!!
        val rides = model.rideSegments
        assertEquals(2, rides.size)
        rides[0].assertRuns(0.0, 0.0, 200.0, 0.0)
        rides[1].assertRuns(200.0, 0.0, 200.0, 200.0)
        for (s in rides) {
            assertEquals(red, s.color)
            assertEquals(ROUTE_LINE_HALF_WIDTH_WORLD, s.r, 0.0)
        }
        val chorded = build(listOf(ride("KCI-AAA", "KCI-BBB")), "KCI-AAA", "KCI-BBB", lEnds)!!
        assertTrue(model.bounds.maxX >= chorded.bounds.maxX && model.bounds.minY <= chorded.bounds.minY)
    }

    @Test
    fun `walks draw the same with or without corridors`() {
        val legs = listOf(ride("KCI-AAA", "KCI-BBB"), walk("KCI-BBB", "MRT-CCC"), ride("MRT-CCC", "MRT-DDD"))
        assertEquals(
            build(legs, "KCI-AAA", "MRT-DDD", inLine)!!.walkDots,
            build(legs, "KCI-AAA", "MRT-DDD", inLine, listOf(corridor(0.0 to 0.0, 300.0 to 0.0)))!!.walkDots,
        )
    }

    @Test
    fun `a marker snaps onto the ridden corridor, not an interchange bar's centroid`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-XCH", 100.0, 40.0), pt("KCI-BBB", 200.0, 0.0))
        val model = build(listOf(ride("KCI-AAA", "KCI-XCH", "KCI-BBB")), "KCI-AAA", "KCI-BBB", points, listOf(corridor(0.0 to 0.0, 200.0 to 0.0)))!!
        val stop = model.stops.single()
        assertEquals(0.0, stop.y, 0.0)
        assertEquals(100.0, stop.x, 0.5)
    }

    @Test
    fun `an end pin snaps onto its line too, in its colour`() {
        val points = listOf(pt("KCI-XCH", 0.0, 40.0), pt("KCI-BBB", 200.0, 0.0))
        val model = build(listOf(ride("KCI-XCH", "KCI-BBB")), "KCI-XCH", "KCI-BBB", points, listOf(corridor(0.0 to 0.0, 200.0 to 0.0)))!!
        val origin = model.overlay.pins.single { it.kind == RoutePinKind.ORIGIN }
        assertEquals(0.0, origin.y, 0.0)
        assertEquals(red, origin.color)
    }

    @Test
    fun `a straight interlined run is one line on the elected stroke`() {
        val corridors = listOf(corridor(0.0 to 0.0, 600.0 to 0.0), corridor(0.0 to 22.0, 1000.0 to 22.0))
        val points = listOf(pt("KCI-AAA", 100.0, 12.0), pt("KCI-BBB", 400.0, 12.0), pt("KCI-CCC", 700.0, 12.0), pt("KCI-DDD", 900.0, 12.0))
        val model = build(listOf(ride("KCI-AAA", "KCI-BBB", "KCI-CCC", "KCI-DDD")), "KCI-AAA", "KCI-DDD", points, corridors)!!
        for (s in model.rideSegments) assertTrue(s.ay == 22.0 && s.by == 22.0)
        for (p in model.overlay.pins) assertEquals(22.0, p.y, 1e-9)
    }

    @Test
    fun `a nearly collinear leg is one straight shot through its dots`() {
        val corridors = listOf(corridor(0.0 to 12.0, 1400.0 to 12.0), corridor(380.0 to -10.0, 1900.0 to -10.0))
        val points = listOf(
            pt("KCI-AAA", 0.0, 12.0), pt("KCI-BBB", 120.0, 12.0), pt("KCI-CCC", 250.0, 12.0),
            pt("KCI-DDD", 380.0, 1.0), pt("KCI-EEE", 900.0, 1.0), pt("KCI-FFF", 1600.0, 1.0), pt("KCI-GGG", 1835.0, 1.0),
        )
        val model = build(
            listOf(ride("KCI-AAA", "KCI-BBB", "KCI-CCC", "KCI-DDD", "KCI-EEE", "KCI-FFF", "KCI-GGG")), "KCI-AAA", "KCI-GGG", points, corridors,
        )!!
        model.rideSegments.single().assertRuns(0.0, 12.0, 1835.0, 12.0)
        for (p in model.overlay.pins) assertEquals(12.0, p.y, 1e-9)
    }

    @Test
    fun `a leg handing off between corridors is one unbroken chain`() {
        val corridors = listOf(corridor(0.0 to 0.0, 400.0 to 0.0), corridor(400.0 to 50.0, 800.0 to 50.0))
        val points = listOf(pt("KCI-AAA", 100.0, 0.0), pt("KCI-BAR", 400.0, 32.0), pt("KCI-BBB", 700.0, 64.0))
        val rides = build(listOf(ride("KCI-AAA", "KCI-BAR", "KCI-BBB")), "KCI-AAA", "KCI-BBB", points, corridors)!!.rideSegments
        for (i in 1 until rides.size) assertEquals(rides[i - 1].bx to rides[i - 1].by, rides[i].ax to rides[i].ay)
        assertTrue(rides.any { it.ax == it.bx && it.ay != it.by })
    }

    @Test
    fun `pairs the corridor misses are chorded, the rest followed`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 200.0), pt("KCI-CCC", 5000.0, 5000.0))
        val rides = build(listOf(ride("KCI-AAA", "KCI-BBB", "KCI-CCC")), "KCI-AAA", "KCI-CCC", points, lCorridor)!!.rideSegments
        assertEquals(3, rides.size)
        rides[2].assertRuns(200.0, 200.0, 5000.0, 5000.0)
    }

    // MRT and Koridor 1 share the Sudirman axis, both red within the tolerance: width tells them apart.
    private val mrtPoints = listOf(pt("MRTJ-STB", 3595.0, 4052.0), pt("MRTJ-DKA", 3632.0, 3596.0), pt("MRTJ-BHI", 3635.0, 3494.0))
    private val mrtLeg = listOf(RouteLeg.Ride("MRTJ:M", "MRTJ", listOf("MRTJ-STB", "MRTJ-DKA", "MRTJ-BHI")))
    private val brtStroke = corridor(3696.0 to 1620.0, 3660.0 to 3500.0, 3640.0 to 4100.0, 3700.0 to 4600.0, 3264.0 to 5039.0, w = 15.0, c = "#DC0D11")

    @Test
    fun `a rail leg chords rather than ride a BRT stroke`() {
        for (s in build(mrtLeg, "MRTJ-STB", "MRTJ-BHI", mrtPoints, listOf(brtStroke), lineColor = { "#ca2a51" })!!.rideSegments) {
            assertTrue(maxOf(s.ay, s.by) <= 4053 && maxOf(s.ax, s.bx) <= 3640)
        }
    }

    @Test
    fun `a rail leg still rides a rail stroke when there is one`() {
        val railStroke = corridor(3306.0 to 4348.0, 3595.0 to 4052.0, 3632.0 to 3596.0, 3636.0 to 3492.0, c = "#CF0E33")
        val rides = build(mrtLeg, "MRTJ-STB", "MRTJ-BHI", mrtPoints, listOf(brtStroke, railStroke), lineColor = { "#ca2a51" })!!.rideSegments
        assertTrue(rides.isNotEmpty())
        for (s in rides) assertTrue(maxOf(s.ax, s.bx) <= 3640)
    }

    private fun traced(key: String, pts: List<Pair<Double, Double>>, markers: List<String>, vararg more: MapLineSegment) = listOf(
        MapLine(
            key, key.substringBefore(':'), key.substringAfter(':'), key, "#FF0000", 5.0,
            listOf(MapLineSegment("TRUNK", (1 until pts.size).map { listOf(pts[it - 1].first, pts[it - 1].second, pts[it].first, pts[it].second) }, markers)) + more,
        ),
    )

    @Test
    fun `a traced line is followed round its corner`() {
        val leg = ride("KCI-AAA", "KCI-BBB")
        val paths = prepareLinePaths(traced(leg.line, listOf(0.0 to 0.0, 200.0 to 0.0, 200.0 to 200.0), leg.stopIds), lEnds)
        val rides = build(listOf(leg), "KCI-AAA", "KCI-BBB", lEnds, linePaths = paths)!!.rideSegments
        assertEquals(2, rides.size)
        rides[0].assertRuns(0.0, 0.0, 200.0, 0.0)
        rides[1].assertRuns(200.0, 0.0, 200.0, 200.0)
    }

    @Test
    fun `a ride takes its own trace over the corridor underneath`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 0.0))
        val leg = ride("KCI-AAA", "KCI-BBB")
        val paths = prepareLinePaths(traced(leg.line, listOf(0.0 to 0.0, 200.0 to 0.0), leg.stopIds), points)
        val detour = corridor(0.0 to 0.0, 100.0 to -100.0, 200.0 to 0.0, c = "#FF0000")
        for (s in build(listOf(leg), "KCI-AAA", "KCI-BBB", points, listOf(detour), paths)!!.rideSegments) assertTrue(minOf(s.ay, s.by) >= 0)
    }

    @Test
    fun `a line the trace doesn't carry falls back to the corridor`() {
        val paths = prepareLinePaths(traced("TJ:99", listOf(0.0 to 0.0, 1.0 to 1.0), emptyList()), lEnds)
        val rides = build(listOf(ride("KCI-AAA", "KCI-BBB")), "KCI-AAA", "KCI-BBB", lEnds, listOf(corridor(0.0 to 0.0, 200.0 to 0.0, 200.0 to 200.0, c = "#FF0000")), paths)!!.rideSegments
        assertEquals(2, rides.size)
        rides[1].assertRuns(200.0, 0.0, 200.0, 200.0)
    }

    @Test
    fun `traced and matched pairs mix in one leg without a gap`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 100.0, 0.0), pt("KCI-CCC", 500.0, 0.0), pt("KCI-DDD", 600.0, 0.0))
        val leg = ride("KCI-AAA", "KCI-BBB", "KCI-CCC", "KCI-DDD")
        val lines = traced(leg.line, listOf(0.0 to 0.0, 100.0 to 0.0), listOf("KCI-AAA", "KCI-BBB"), MapLineSegment("TRUNK", listOf(listOf(500.0, 0.0, 600.0, 0.0)), listOf("KCI-CCC", "KCI-DDD")))
        val rides = build(listOf(leg), "KCI-AAA", "KCI-DDD", points, listOf(corridor(0.0 to 0.0, 600.0 to 0.0, c = "#FF0000")), prepareLinePaths(lines, points))!!.rideSegments
        val xs = rides.flatMap { listOf(it.ax, it.bx) }
        assertEquals(0.0, xs.min(), 0.0)
        assertEquals(600.0, xs.max(), 0.0)
        for (i in 1 until rides.size) assertEquals(rides[i - 1].bx, rides[i].ax, 1e-5)
    }

    @Test
    fun `stop dots sit on the traced stroke, not the tap target`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-XCH", 100.0, 40.0), pt("KCI-BBB", 200.0, 0.0))
        val leg = ride("KCI-AAA", "KCI-XCH", "KCI-BBB")
        val paths = prepareLinePaths(traced(leg.line, listOf(0.0 to 0.0, 200.0 to 0.0), leg.stopIds), points)
        val stop = build(listOf(leg), "KCI-AAA", "KCI-BBB", points, linePaths = paths)!!.stops.single()
        assertEquals(0.0, stop.y, 0.0)
        assertEquals(100.0, stop.x, 0.5)
    }

    // Beyond the web: each ride as one polyline, and where its stops lie along it.

    @Test
    fun `a ride's path runs its drawing, its stops placed along it, undrawn ones between`() {
        val points = listOf(pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 200.0, 200.0))
        val model = build(listOf(ride("KCI-AAA", "TJ-GONE", "KCI-BBB")), "KCI-AAA", "KCI-BBB", points, lCorridor)!!
        val path = model.rides.single()
        assertEquals(listOf(0.0 to 0.0, 200.0 to 0.0, 200.0 to 200.0), path.path.map { it.x to it.y })
        assertEquals(listOf(0.0, 200.0, 400.0), path.stopArcs.toList())
    }

    @Test
    fun `a flattened leg's stops are placed along its one segment`() {
        val corridors = listOf(corridor(0.0 to 22.0, 1000.0 to 22.0))
        val points = listOf(pt("KCI-AAA", 100.0, 12.0), pt("KCI-BBB", 400.0, 12.0), pt("KCI-CCC", 900.0, 12.0))
        val model = build(listOf(ride("KCI-AAA", "KCI-BBB", "KCI-CCC")), "KCI-AAA", "KCI-CCC", points, corridors)!!
        val arcs = model.rides.single().stopArcs
        assertEquals(0.0, arcs[0], 1e-9)
        assertEquals(300.0, arcs[1], 1e-9)
        assertEquals(800.0, arcs[2], 1e-9)
    }

    @Test
    fun `a real route draws on the shipped map`() {
        // Manggarai to Lebak Bulus: the Cikarang line to Sudirman, the walk to Dukuh Atas, the MRT south.
        val points = WebMapData.points.points
        val lines = WebMapData.lines.lines
        val mrt = lines.lineOf("MRTJ:M")!!.segments.single().markers
        val model = buildRouteOverlayModel(
            legs = listOf(
                RouteLeg.Ride("KCI:C", "KCI", listOf("KCI-MRI", "KCI-SUD")),
                RouteLeg.Walk("KCI-SUD", "MRTJ-DKA"),
                RouteLeg.Ride("MRTJ:M", "MRTJ", mrt.subList(0, mrt.indexOf("MRTJ-DKA") + 1).reversed()),
            ),
            fromId = "KCI-MRI",
            toId = "MRTJ-LBB",
            points = points,
            lineColor = { key -> lines.lineOf(key)?.color },
            corridors = prepareCorridors(WebMapData.corridors.corridors),
            linePaths = prepareLinePaths(lines, points),
            connectors = WebMapData.corridors.connectors.map { c -> c.map { WorldPoint(it[0], it[1]) } },
        )!!
        assertEquals(listOf(0, 2), model.rides.map { it.legIndex })
        assertTrue(model.overlay.segments.any { it.kind == RouteSegmentKind.TRANSFER })
        assertEquals(1, model.overlay.pins.count { it.kind == RoutePinKind.ORIGIN })
        assertEquals(1, model.overlay.pins.count { it.kind == RoutePinKind.DESTINATION })
        // The MRT is traced end to end: one polyline, its stops in order along it.
        val southbound = model.rides.last()
        assertTrue(southbound.path.size >= 2)
        val arcs = southbound.stopArcs
        assertEquals(0.0, arcs.first(), 1e-9)
        for (i in 1 until arcs.size) assertTrue(arcs[i] > arcs[i - 1])
        assertEquals(polylineLength(southbound.path), arcs.last(), 1e-6)
    }
}
