package id.shiorilabs.commute.feature.map.presentation

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.Typeface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import id.shiorilabs.commute.core.font.R as FontR
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.splitStationNumber
import id.shiorilabs.commute.feature.map.domain.BUS_LINE_W_15_DP
import id.shiorilabs.commute.feature.map.domain.BusMapLineInfo
import id.shiorilabs.commute.feature.map.domain.BusMapProps
import id.shiorilabs.commute.feature.map.domain.GeoStop
import id.shiorilabs.commute.feature.map.domain.RAIL_LINE_WEIGHT
import id.shiorilabs.commute.feature.map.domain.RAIL_POI_KIND
import id.shiorilabs.commute.feature.map.domain.stopsInView
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.BackgroundLayer
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.Layer
import org.maplibre.android.style.layers.LayoutPropertyValue
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PaintPropertyValue
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.PropertyValue
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import kotlin.math.roundToInt

/**
 * The map's streets layer: shirase's finished style as served, Peta Bus's lines, haltes and rail
 * stations over it under the style's `commute-overlay` slot, and the rider's dot when location is
 * already allowed (this layer never asks). A halte or station tapped goes to [onStationTap] by its
 * station id. Drawn by MapLibre into its own SurfaceView, as the artwork's renderer draws into its.
 */
@Composable
fun StreetsMap(
    state: StreetsMapState,
    styleUrl: String,
    busMap: BusMapLayer?,
    dark: Boolean,
    onStationTap: (stationId: String) -> Unit,
    modifier: Modifier = Modifier,
    onTap: () -> Unit = {},
    onUserMove: () -> Unit = {},
    /** A stroke tapped, by its lines' codes (several where a colour's lines are one stroke): the caller isolates one. */
    onLineTap: (codes: List<String>) -> Unit = {},
    /** The line drawn alone, the rest faded, as the artwork isolates one; null for all of them. */
    isolated: String? = null,
    /** The debug panel's pick: the network as it shows, or every line raw or processed, unbundled, in its place. */
    lines: StreetsLines = StreetsLines.ADJUSTED,
    /** Raw's lines as GeoJSON, once read; null till then. */
    feed: String? = null,
    /** The halte and station marks drawn. */
    dots: StreetsDots = StreetsDots.ALL,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val screenDensity = LocalDensity.current.density
    // The roundels' face, as core/ui's: PT Sans Narrow Bold.
    val roundelFace = remember(context) { runCatching { ResourcesCompat.getFont(context, FontR.font.pt_sans_narrow_bold) }.getOrNull() }
    val tapSlop = TAP_SLOP_DP * screenDensity
    val onStation by rememberUpdatedState(onStationTap)
    val onAnyTap by rememberUpdatedState(onTap)
    val onMove by rememberUpdatedState(onUserMove)
    val onLine by rememberUpdatedState(onLineTap)

    val mapView = remember {
        MapLibre.getInstance(context.applicationContext)
        MapView(context).apply { onCreate(null) }
    }

    // MapView's lifecycle follows the screen's, and ends with it.
    DisposableEffect(lifecycle, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            state.saveCamera()
            state.detach()
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mapView.onPause()
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) mapView.onStop()
            mapView.onDestroy()
        }
    }

    LaunchedEffect(mapView) {
        mapView.getMapAsync { map ->
            state.attach(map, mapView)
            map.uiSettings.apply {
                isLogoEnabled = false
                // Credited in the map's own attribution, behind its info button.
                isAttributionEnabled = false
                // MapLibre's sat under the status bar and the layers button; recentring turns north up.
                isCompassEnabled = false
                isRotateGesturesEnabled = true
                isTiltGesturesEnabled = false
            }
            map.setLatLngBoundsForCameraTarget(JABODETABEK)
            map.setMinZoomPreference(MIN_ZOOM)
            map.setMaxZoomPreference(MAX_ZOOM)
            map.addOnMapClickListener { at ->
                onAnyTap()
                val p = map.projection.toScreenLocation(at)
                val box = RectF(p.x - tapSlop, p.y - tapSlop, p.x + tapSlop, p.y + tapSlop)
                val hit = map.queryRenderedFeatures(box, BAR_LAYER, MARK_DOT_LAYER, HALTE_LAYER, RAIL_LAYER, RAIL_DOT_LAYER, RAIL_MINOR_DOT_LAYER)
                    .minByOrNull { feature ->
                        val point = feature.geometry() as? org.maplibre.geojson.Point ?: return@minByOrNull Float.MAX_VALUE
                        val s = map.projection.toScreenLocation(LatLng(point.latitude(), point.longitude()))
                        (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y)
                    }
                val stationId = hit?.getStringProperty(BusMapProps.STATION_ID)
                if (stationId != null) {
                    onStation(stationId)
                    return@addOnMapClickListener true
                }
                // No stop under the finger: a line, the one drawn on top there.
                val tapped = map.queryRenderedFeatures(box, DEBUG_ISOLATE_LAYER, DEBUG_LAYER, ISOLATE_LAYER, BRT_ROUTE_LAYER, AUI_ROUTE_LAYER, BRT_LAYER, AUI_LAYER, TRUNK_LAYER)
                    .firstNotNullOfOrNull { feature ->
                        // A stroke carries all its lines; a line on its own streets, just its code.
                        feature.getStringProperty(BusMapProps.LINES)?.split(' ')?.filter(String::isNotEmpty)?.ifEmpty { null }
                            ?: feature.getStringProperty(BusMapProps.CODE)?.let(::listOf)
                    }
                    ?: return@addOnMapClickListener false
                onLine(tapped)
                true
            }
            map.addOnCameraIdleListener { state.saveCamera() }
            // Panned or pinched by the rider, as the artwork's onUserMove: home's sheet turns to "Sekitar".
            map.addOnCameraMoveStartedListener { reason ->
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) onMove()
            }
        }
    }

    // A theme or detail change swaps the style; Peta Bus and the rider's dot go back over the new one.
    LaunchedEffect(state.map, styleUrl) {
        val map = state.map ?: return@LaunchedEffect
        map.setStyle(Style.Builder().fromUri(styleUrl)) { style ->
            state.style = style
            state.enableRider(context, style)
        }
    }
    LaunchedEffect(state.style, busMap, dark) {
        val style = state.style ?: return@LaunchedEffect
        if (!style.isFullyLoaded || busMap == null) return@LaunchedEffect
        addBusMap(style, busMap, dark, screenDensity, roundelFace)
    }
    // As it shows, or raw or processed, and a line alone: the rest faded under it, it over them.
    LaunchedEffect(state.style, busMap, dark, isolated, lines, feed, dots) {
        val style = state.style ?: return@LaunchedEffect
        if (!style.isFullyLoaded || busMap == null) return@LaunchedEffect
        val debug = when (lines) {
            StreetsLines.RAW -> feed ?: EMPTY_COLLECTION
            StreetsLines.PROCESSED -> busMap.geoJson.processed
            StreetsLines.ADJUSTED -> null
        }
        if (debug != null) style.getSourceAs<GeoJsonSource>(DEBUG_SOURCE)?.setGeoJson(debug)
        showLines(style, debug = debug != null, code = isolated, dots = dots)
    }

    AndroidView(factory = { mapView }, modifier = modifier)
}

/** The streets layer's map once it has one, for the chrome's recentre and the camera kept between visits. */
@Stable
class StreetsMapState(private val initial: StreetsCamera?, private val save: (StreetsCamera) -> Unit) {

    var map: MapLibreMap? by mutableStateOf(null)
        private set

    var style: Style? by mutableStateOf(null)
        internal set

    /** Which way the map faces, degrees clockwise from north: the north button shows while it's turned. */
    var bearing: Double by mutableStateOf(initial?.bearing ?: 0.0)
        private set

    private var riderShown = false
    private var view: MapView? = null

    /** What a sheet covers at the map's foot, in px: the camera centres on what shows above it. */
    private var bottomInsetPx = 0.0

    internal fun attach(map: MapLibreMap, view: MapView) {
        this.view = view
        map.moveCamera(CameraUpdateFactory.paddingTo(0.0, 0.0, 0.0, bottomInsetPx))
        val at = initial ?: DEFAULT_CAMERA
        map.cameraPosition = CameraPosition.Builder()
            .target(LatLng(at.latitude, at.longitude))
            .zoom(at.zoom)
            .bearing(at.bearing)
            .build()
        bearing = map.cameraPosition.bearing
        map.addOnCameraMoveListener { bearing = map.cameraPosition.bearing }
        map.addOnCameraIdleListener { bearing = map.cameraPosition.bearing }
        this.map = map
    }

    internal fun detach() {
        map = null
        style = null
        view = null
    }

    /** Home's feed resting over the map's foot: the middle of the camera moves up into what shows. */
    fun setBottomInset(px: Double) {
        if (px == bottomInsetPx) return
        bottomInsetPx = px
        map?.moveCamera(CameraUpdateFactory.paddingTo(0.0, 0.0, 0.0, px))
    }

    /** The stations shown above the sheet, nearest the middle of what shows first: home's "Sekitar". */
    fun stationsInView(stops: List<GeoStop>, limit: Int): List<String> {
        val map = map ?: return emptyList()
        val view = view ?: return emptyList()
        val width = view.width.toFloat()
        val shown = (view.height - bottomInsetPx).coerceAtLeast(1.0).toFloat()
        if (width <= 0f) return emptyList()
        val corners = listOf(PointF(0f, 0f), PointF(width, 0f), PointF(0f, shown), PointF(width, shown))
            .map { map.projection.fromScreenLocation(it) }
        val middle = map.projection.fromScreenLocation(PointF(width / 2, shown / 2))
        return stopsInView(
            stops = stops,
            south = corners.minOf { it.latitude },
            west = corners.minOf { it.longitude },
            north = corners.maxOf { it.latitude },
            east = corners.maxOf { it.longitude },
            centreLat = middle.latitude,
            centreLng = middle.longitude,
            limit = limit,
        )
    }

    internal fun saveCamera() {
        val camera = map?.cameraPosition ?: return
        val target = camera.target ?: return
        save(StreetsCamera(target.latitude, target.longitude, camera.zoom, camera.bearing))
    }

    /** The rider's dot, if location is already allowed; first shown, the camera goes to them once. */
    @SuppressLint("MissingPermission")
    internal fun enableRider(context: Context, style: Style) {
        val map = map ?: return
        if (!hasLocation(context)) return
        val component = map.locationComponent
        runCatching {
            component.activateLocationComponent(
                LocationComponentActivationOptions.builder(context, style).useDefaultLocationEngine(true).build(),
            )
            component.isLocationComponentEnabled = true
            component.renderMode = RenderMode.COMPASS
            component.cameraMode = CameraMode.NONE
        }
        if (!riderShown && initial == null) {
            riderShown = true
            component.lastKnownLocation?.let { fix ->
                val at = LatLng(fix.latitude, fix.longitude)
                if (JABODETABEK.contains(at)) map.cameraPosition = CameraPosition.Builder().target(at).zoom(RIDER_ZOOM).build()
            }
        }
    }

    /** The whole of a line picked alone in view, above whatever covers the map's foot ([bottomPx]). */
    fun frame(line: BusMapLineInfo, bottomPx: Double, edgePx: Double) {
        val map = map ?: return
        if (line.south > line.north || line.west > line.east) return
        val bounds = LatLngBounds.from(line.north, line.east, line.south, line.west)
        map.animateCamera(
            CameraUpdateFactory.newLatLngBounds(bounds, edgePx.toInt(), edgePx.toInt(), edgePx.toInt(), (bottomPx + edgePx).toInt()),
            RECENTER_MILLIS,
        )
    }

    /** The map turned back to face north, where it is and as near as it is. */
    fun northUp() {
        val map = map ?: return
        map.animateCamera(CameraUpdateFactory.bearingTo(0.0), RECENTER_MILLIS)
    }

    /** Onto the rider if their whereabouts are known and on the map, else the whole of central Jakarta. */
    @SuppressLint("MissingPermission")
    fun recenter() {
        val map = map ?: return
        val fix = runCatching { map.locationComponent.takeIf { it.isLocationComponentActivated }?.lastKnownLocation }.getOrNull()
        val at = fix?.let { LatLng(it.latitude, it.longitude) }?.takeIf { JABODETABEK.contains(it) }
        val update = if (at != null) {
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder().target(at).zoom(maxOf(map.cameraPosition.zoom, RIDER_ZOOM)).bearing(0.0).build(),
            )
        } else {
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder()
                    .target(LatLng(DEFAULT_CAMERA.latitude, DEFAULT_CAMERA.longitude))
                    .zoom(DEFAULT_CAMERA.zoom)
                    .bearing(0.0)
                    .build(),
            )
        }
        map.animateCamera(update, RECENTER_MILLIS)
    }
}

@Composable
fun rememberStreetsMapState(session: MapSession): StreetsMapState =
    remember(session) { StreetsMapState(initial = session.streetsCamera, save = { session.streetsCamera = it }) }

private fun hasLocation(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

/**
 * Peta Bus over [style], under its `commute-overlay` slot so the basemap's labels stay on top:
 * Angkutan Umum Integrasi lines, then BRT koridors over them, then haltes and the rail stations;
 * the haltes' names up close go over everything. Replaces what an earlier call added, for a theme
 * change.
 */
private fun addBusMap(style: Style, busMap: BusMapLayer, dark: Boolean, density: Float, typeface: Typeface?) {
    for (id in LINE_LAYERS + CASING_LAYERS + listOf(WASH_LAYER, ISOLATE_LAYER, DEBUG_LAYER, DEBUG_ISOLATE_LAYER, BAR_LAYER, MARK_DOT_LAYER, RAIL_LAYER, RAIL_DOT_LAYER, RAIL_MINOR_DOT_LAYER, HALTE_NAME_LAYER, HALTE_LAYER)) style.removeLayer(id)
    for (id in listOf(LINES_SOURCE, ROUTES_SOURCE, DEBUG_SOURCE, HALTES_SOURCE, RAIL_SOURCE, MARKS_SOURCE)) style.removeSource(id)

    style.addSource(GeoJsonSource(LINES_SOURCE, busMap.geoJson.lines))
    style.addSource(GeoJsonSource(ROUTES_SOURCE, busMap.geoJson.routes))
    style.addSource(GeoJsonSource(HALTES_SOURCE, busMap.geoJson.haltes))
    style.addSource(GeoJsonSource(RAIL_SOURCE, busMap.geoJson.rail))
    style.addSource(GeoJsonSource(MARKS_SOURCE, busMap.geoJson.marks))
    style.addSource(GeoJsonSource(DEBUG_SOURCE, busMap.geoJson.processed))

    val color = Expression.get(BusMapProps.COLOR)
    val zoom = Expression.zoom()
    val trunkKinds = Expression.any(
        Expression.eq(Expression.get(BusMapProps.KIND), Expression.literal("BRT")),
        Expression.eq(Expression.get(BusMapProps.KIND), Expression.literal("RAIL")),
    )
    // One width for every line, and each stretch that many widths across from where it runs, so lines
    // sharing a street lie side by side as Transit draws them. [scale] widens the lot. Each drawn a
    // little narrower than its place ([LINE_FILL]) over a casing in the ground's colour a place wide
    // and [CASING_DP] more either side, as Transit cases its lines: a hairline between the stripes of
    // a bundle, an edge round it, the road and the line beside it kept apart.
    // A stroke as wide as its weight: a rail line's heavier ([RAIL_LINE_WEIGHT]).
    val weight = Expression.coalesce(Expression.get(BusMapProps.WEIGHT), Expression.literal(1.0))
    fun weighed(w: Float, casing: Float) = Expression.sum(Expression.product(weight, Expression.literal(w)), Expression.literal(2 * casing))
    fun width(scale: Float, fill: Float = LINE_FILL, casing: Float = 0f) = Expression.interpolate(
        Expression.linear(), zoom,
        Expression.stop(10, weighed(LINE_W_10 * scale * fill, casing)), Expression.stop(13, weighed(LINE_W_13 * scale * fill, casing)),
        Expression.stop(15, weighed(LINE_W_15 * scale * fill, casing)), Expression.stop(18, weighed(LINE_W_18 * scale * fill, casing)),
    )
    // A line on its own geometry, by its kind: a rail line [RAIL_LINE_WEIGHT] a bus line's width.
    val isRail = Expression.eq(Expression.get(BusMapProps.KIND), Expression.literal("RAIL"))
    fun byKind(w: Float, casing: Float = 0f) = Expression.switchCase(
        isRail, Expression.literal(w * RAIL_LINE_WEIGHT.toFloat() + 2 * casing),
        Expression.literal(w + 2 * casing),
    )
    val casingColor = if (dark) CASING_DARK else CASING_LIGHT
    // A line layer's casing, under every line: its ground-coloured outline, [width] wide.
    fun casing(line: LineLayer, width: Expression, offset: Expression? = null) = LineLayer(line.id + CASING_SUFFIX, line.sourceId).withProperties(
        PropertyFactory.lineColor(casingColor),
        PropertyFactory.lineWidth(width),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
    ).apply {
        if (offset != null) setProperties(PropertyFactory.lineOffset(offset))
        line.filter?.let { setFilter(it) }
        minZoom = line.minZoom
        maxZoom = line.maxZoom
        setProperties(PropertyFactory.visibility(line.visibility.value ?: Property.VISIBLE))
    }
    fun offset(property: String, scale: Float): Expression {
        val slot = Expression.get(property)
        return Expression.interpolate(
            Expression.linear(), zoom,
            Expression.stop(10, Expression.product(slot, Expression.literal(LINE_W_10 * scale))),
            Expression.stop(13, Expression.product(slot, Expression.literal(LINE_W_13 * scale))),
            Expression.stop(15, Expression.product(slot, Expression.literal(LINE_W_15 * scale))),
            Expression.stop(18, Expression.product(slot, Expression.literal(LINE_W_18 * scale))),
        )
    }
    fun lines(id: String, slot: String, filter: Expression, scale: Float = 1f) = LineLayer(id, LINES_SOURCE).withProperties(
        PropertyFactory.lineColor(Expression.toColor(color)),
        PropertyFactory.lineWidth(width(scale)),
        PropertyFactory.lineOffset(offset(slot, scale)),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
    ).withFilter(filter)
    // Zoomed out, the trunk koridors alone (plain-number BRTs and L13E), closed up among themselves and
    // drawn bolder, there being fewer: the city's network rather than every branch and feeder. Closer
    // in, every line at its own place.
    val trunks = lines(TRUNK_LAYER, BusMapProps.TRUNK_SLOT, Expression.has(BusMapProps.TRUNK_SLOT), TRUNK_SCALE)
        .apply { maxZoom = ALL_LINES_MIN_ZOOM }
    val aui = lines(AUI_LAYER, BusMapProps.SLOT, Expression.eq(Expression.get(BusMapProps.KIND), Expression.literal("AUI")))
        .apply {
            minZoom = ALL_LINES_MIN_ZOOM
            maxZoom = STREET_ZOOM
        }
    // Koridors and rail lines alike: the rail lines are bundled with them as equals.
    val brt = lines(BRT_LAYER, BusMapProps.SLOT, trunkKinds)
        .apply {
            minZoom = ALL_LINES_MIN_ZOOM
            maxZoom = STREET_ZOOM
        }
    // At street zoom, every line on its own streets, thin and unbundled: the streets are what's read
    // there, and a bundle drawn into a junction's one point (Bundaran HI) jumps off them.
    fun routes(id: String, kinds: Expression) = LineLayer(id, ROUTES_SOURCE).withProperties(
        PropertyFactory.lineColor(Expression.toColor(color)),
        PropertyFactory.lineWidth(Expression.interpolate(Expression.linear(), zoom, Expression.stop(STREET_ZOOM, byKind(ROUTE_W_16)), Expression.stop(18, byKind(ROUTE_W_18)))),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
    ).withFilter(kinds).apply { minZoom = STREET_ZOOM }
    val auiRoutes = routes(AUI_ROUTE_LAYER, Expression.eq(Expression.get(BusMapProps.KIND), Expression.literal("AUI")))
    val brtRoutes = routes(BRT_ROUTE_LAYER, trunkKinds)
    val routeCasing = Expression.interpolate(
        Expression.linear(), zoom,
        Expression.stop(STREET_ZOOM, byKind(ROUTE_W_16, CASING_DP)), Expression.stop(18, byKind(ROUTE_W_18, CASING_DP)),
    )
    // A line alone, over the rest faded: on its own streets at every zoom. Hidden until one is picked.
    val alone = LineLayer(ISOLATE_LAYER, ROUTES_SOURCE).withProperties(
        PropertyFactory.lineColor(Expression.toColor(color)),
        PropertyFactory.lineWidth(
            Expression.interpolate(Expression.linear(), zoom, Expression.stop(10, byKind(ALONE_W_10)), Expression.stop(14, byKind(ALONE_W_14)), Expression.stop(18, byKind(ALONE_W_18))),
        ),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        PropertyFactory.visibility(Property.NONE),
    )
    // The debug panel's raw or processed lines: thin and unbundled at every zoom, one over another
    // where they share a street. Hidden until picked; a line alone over the rest.
    fun debug(id: String, scale: Float) = LineLayer(id, DEBUG_SOURCE).withProperties(
        PropertyFactory.lineColor(Expression.toColor(color)),
        PropertyFactory.lineWidth(
            Expression.interpolate(Expression.linear(), zoom, Expression.stop(10, DEBUG_W_10 * scale), Expression.stop(14, DEBUG_W_14 * scale), Expression.stop(18, DEBUG_W_18 * scale)),
        ),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        PropertyFactory.visibility(Property.NONE),
    )
    val debugLines = debug(DEBUG_LAYER, 1f)
    val debugAlone = debug(DEBUG_ISOLATE_LAYER, DEBUG_ALONE_SCALE)
    val haltes = CircleLayer(HALTE_LAYER, HALTES_SOURCE).withProperties(
        PropertyFactory.circleRadius(Expression.interpolate(Expression.linear(), zoom, Expression.stop(13, 2f), Expression.stop(16, 5f), Expression.stop(18, 7f))),
        PropertyFactory.circleColor(if (dark) HALTE_FILL_DARK else HALTE_FILL),
        PropertyFactory.circleStrokeColor(if (dark) HALTE_STROKE_DARK else HALTE_STROKE),
        PropertyFactory.circleStrokeWidth(1.5f),
    ).apply { minZoom = STREET_ZOOM }
    val names = SymbolLayer(HALTE_NAME_LAYER, HALTES_SOURCE).withProperties(
        PropertyFactory.textField(Expression.get(BusMapProps.NAME)),
        PropertyFactory.textFont(arrayOf(LABEL_FONT)),
        PropertyFactory.textSize(11f),
        PropertyFactory.textAnchor(Property.TEXT_ANCHOR_TOP),
        PropertyFactory.textOffset(arrayOf(0f, 0.8f)),
        PropertyFactory.textColor(if (dark) HALTE_TEXT_DARK else HALTE_TEXT),
        PropertyFactory.textHaloColor(if (dark) HALTE_HALO_DARK else HALTE_HALO),
        PropertyFactory.textHaloWidth(1.5f),
        PropertyFactory.textOptional(true),
    ).apply { minZoom = HALTE_NAME_MIN_ZOOM }
    val rail = railStations(style, busMap.railRoundels, density, typeface)
    // A wash over the basemap first, as Transit lays a white overlay: its streets and fills step back
    // behind the lines, its labels (over the slot) stay sharp.
    val wash = BackgroundLayer(WASH_LAYER).withProperties(
        PropertyFactory.backgroundColor(if (dark) WASH_DARK else WASH_LIGHT),
        PropertyFactory.backgroundOpacity(WASH_OPACITY),
    )
    // Each halte on its bundle, from city zoom to street zoom: a bar across them all, or a dot on its
    // one line, white with a dark outline, as Transit marks stops.
    for (n in 2..MAX_BAR_LINES) style.addImage("$BAR_IMAGE$n", barImage(n, density))
    val bars = SymbolLayer(BAR_LAYER, MARKS_SOURCE).withProperties(
        PropertyFactory.iconImage(Expression.concat(Expression.literal(BAR_IMAGE), Expression.toString(Expression.get(BusMapProps.COUNT)))),
        PropertyFactory.iconRotate(Expression.get(BusMapProps.BEARING)),
        PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
        PropertyFactory.iconAllowOverlap(true),
        PropertyFactory.iconIgnorePlacement(true),
        // The bundle's width, as the lines': drawn for z15's, scaled with them.
        PropertyFactory.iconSize(
            Expression.interpolate(Expression.linear(), zoom, Expression.stop(10, LINE_W_10 / LINE_W_15), Expression.stop(13, LINE_W_13 / LINE_W_15), Expression.stop(15, 1f), Expression.stop(18, LINE_W_18 / LINE_W_15)),
        ),
        // Across with its bundle where that is moved off the street's middle: in z15's dp, scaled by
        // the icon size as the bar is, and turned with it. Typed, as icon-offset takes only an
        // array<number, 2>, which Expression.array() doesn't assert.
        PropertyFactory.iconOffset(Expression.raw("""["array", "number", 2, ["get", "${BusMapProps.BAR_OFFSET}"]]""")),
    ).withFilter(Expression.gt(Expression.get(BusMapProps.COUNT), Expression.literal(1))).apply {
        minZoom = MARKS_MIN_ZOOM
        maxZoom = STREET_ZOOM
    }
    val dots = CircleLayer(MARK_DOT_LAYER, MARKS_SOURCE).withProperties(
        PropertyFactory.circleColor(HALTE_FILL),
        PropertyFactory.circleRadius(Expression.interpolate(Expression.linear(), zoom, Expression.stop(11, 1.6f), Expression.stop(13, 2.5f), Expression.stop(15, 3.5f), Expression.stop(16, 4.2f))),
        PropertyFactory.circleStrokeColor(MARK_OUTLINE),
        PropertyFactory.circleStrokeWidth(Expression.interpolate(Expression.linear(), zoom, Expression.stop(11, 0.8f), Expression.stop(15, 1.2f))),
    ).withFilter(Expression.eq(Expression.get(BusMapProps.COUNT), Expression.literal(1))).apply {
        minZoom = MARKS_MIN_ZOOM
        maxZoom = STREET_ZOOM
    }
    val aloneCasing = casing(
        alone,
        Expression.interpolate(
            Expression.linear(), zoom,
            Expression.stop(10, byKind(ALONE_W_10, CASING_DP)), Expression.stop(14, byKind(ALONE_W_14, CASING_DP)), Expression.stop(18, byKind(ALONE_W_18, CASING_DP)),
        ),
    )
    val casings = listOf(
        casing(trunks, width(TRUNK_SCALE, fill = 1f, casing = CASING_DP), offset(BusMapProps.TRUNK_SLOT, TRUNK_SCALE)),
        casing(aui, width(1f, fill = 1f, casing = CASING_DP), offset(BusMapProps.SLOT, 1f)),
        casing(brt, width(1f, fill = 1f, casing = CASING_DP), offset(BusMapProps.SLOT, 1f)),
        casing(auiRoutes, routeCasing),
        casing(brtRoutes, routeCasing),
    )
    // The casings under every line, so a line's edge never cuts the one beside it; the alone line's
    // under it alone, over the rest faded.
    for (layer: Layer in listOf(wash) + casings + listOf(trunks, aui, brt, auiRoutes, brtRoutes, debugLines, aloneCasing, alone, debugAlone, dots, bars, haltes)) {
        if (style.getLayer(OVERLAY_SLOT) != null) style.addLayerBelow(layer, OVERLAY_SLOT) else style.addLayer(layer)
    }
    // Halte names over the whole style: under the basemap's labels they lost every collision to a
    // road's name, and a halte's name is what the layer is for. The rail stations over those, as
    // the basemap drew its own over every other place.
    style.addLayer(names)
    for (layer in rail) style.addLayer(layer)
}

/**
 * The rail stations. Zoomed out, as Transit draws them: a dot in its line's colour, white at an
 * interchange; the major ones alone ([BusMapProps.MAJOR]: interchanges and lines' ends) furthest out
 * and the only ones named, so the network reads rather than a carpet of badges. From
 * [RAIL_ROUNDELS_MIN_ZOOM], every one as its roundels, the app's station roundel a line apiece
 * (white face, the line's ring, `C` over `12`) as Singapore's map badges its stations. The name
 * beside them in the basemap's own look for a station, read off shirase's `pois` layer as served (a
 * theme's colours with it). shirase's own stations are hidden: OSM's point beside ours drew Sudirman
 * twice.
 */
private fun railStations(style: Style, roundels: Map<String, List<RailRoundel>>, density: Float, typeface: Typeface?): List<SymbolLayer> {
    for ((image, faces) in roundels) {
        style.addImage(image, roundelImage(faces, density, typeface))
        style.addImage(RAIL_DOT_IMAGE + image, dotImage(faces, density))
    }
    val pois = style.getLayer(BASEMAP_POIS_LAYER) as? SymbolLayer
    if (pois != null) {
        val notStations = Expression.neq(Expression.get(BusMapProps.KIND), Expression.literal(RAIL_POI_KIND))
        pois.setFilter(pois.filter?.let { Expression.all(it, notStations) } ?: notStations)
    }
    // The name: right of the mark, or left of it where that has no room; the mark kept where neither has.
    fun named(id: String, offset: Expression): SymbolLayer {
        val layer = SymbolLayer(id, RAIL_SOURCE)
        if (pois != null) {
            fun <T> value(property: PropertyValue<T>): Any? = if (property.isExpression) property.expression else property.value
            val layout = with(pois) { listOf(textFont, textMaxWidth, textLetterSpacing, textTransform) }
            val paint = with(pois) { listOf(textOpacity, textColor, textHaloColor, textHaloWidth, textHaloBlur) }
            layer.setProperties(
                *layout.mapNotNull { p -> value(p)?.let { LayoutPropertyValue(p.name, it) } }.toTypedArray(),
                *paint.mapNotNull { p -> value(p)?.let { PaintPropertyValue(p.name, it) } }.toTypedArray(),
            )
        } else {
            layer.setProperties(PropertyFactory.textFont(arrayOf(LABEL_FONT)))
        }
        layer.setProperties(
            PropertyFactory.textField(Expression.get(BusMapProps.NAME)),
            PropertyFactory.textSize(RAIL_NAME_SIZE),
            PropertyFactory.textVariableAnchor(arrayOf(Property.TEXT_ANCHOR_LEFT, Property.TEXT_ANCHOR_RIGHT)),
            PropertyFactory.textJustify(Property.TEXT_JUSTIFY_AUTO),
            PropertyFactory.textRadialOffset(offset),
            PropertyFactory.textOptional(true),
        )
        return layer
    }
    val zoom = Expression.zoom()
    val major = Expression.eq(Expression.get(BusMapProps.MAJOR), Expression.literal(true))
    val dotImage = Expression.concat(Expression.literal(RAIL_DOT_IMAGE), Expression.get(BusMapProps.ICON))
    val dots = named(RAIL_DOT_LAYER, railDotNameOffset()).apply {
        setProperties(PropertyFactory.iconImage(dotImage))
        setFilter(major)
        maxZoom = RAIL_ROUNDELS_MIN_ZOOM
    }
    // The rest, nearer in: dots alone, kept where they meet another's mark, as Transit keeps its stops.
    val minorDots = SymbolLayer(RAIL_MINOR_DOT_LAYER, RAIL_SOURCE).withProperties(
        PropertyFactory.iconImage(dotImage),
        PropertyFactory.iconAllowOverlap(true),
    ).withFilter(Expression.not(major)).apply {
        minZoom = RAIL_MINOR_DOTS_MIN_ZOOM
        maxZoom = RAIL_ROUNDELS_MIN_ZOOM
    }
    val rail = named(
        RAIL_LAYER,
        Expression.interpolate(
            Expression.linear(), zoom,
            Expression.stop(RAIL_ROUNDELS_MIN_ZOOM, railNameOffset(ROUNDEL_SCALE_13)),
            Expression.stop(15, railNameOffset(1f)),
        ),
    ).apply {
        setProperties(
            PropertyFactory.iconImage(Expression.get(BusMapProps.ICON)),
            PropertyFactory.iconSize(
                Expression.interpolate(Expression.linear(), zoom, Expression.stop(RAIL_ROUNDELS_MIN_ZOOM, ROUNDEL_SCALE_13), Expression.stop(15, 1f)),
            ),
        )
        minZoom = RAIL_ROUNDELS_MIN_ZOOM
    }
    return listOf(minorDots, dots, rail)
}

/**
 * A station zoomed out: a white capsule ringed in the roundels' ink holding a bead in each of its
 * lines' colours, left to right as its roundels go (the row of them shrunk; zooming in, the beads
 * grow into roundels). An unnumbered station's, whose lines the map doesn't know, is a plain white dot.
 */
private fun dotImage(faces: List<RailRoundel>, density: Float): Bitmap {
    val bead = RAIL_BEAD_DP * density
    val gap = RAIL_BEAD_GAP_DP * density
    val pad = RAIL_CAPSULE_PAD_DP * density
    val height = bead + 2 * pad
    val width = if (faces.isEmpty()) height else faces.size * bead + (faces.size - 1) * gap + 2 * pad
    val bitmap = Bitmap.createBitmap(width.roundToInt().coerceAtLeast(1), height.roundToInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val ring = RAIL_CAPSULE_RING_DP * density
    val outer = RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat())
    val r = outer.height() / 2
    canvas.drawRoundRect(outer, r, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE })
    val inset = RectF(outer).apply { inset(ring / 2, ring / 2) }
    canvas.drawRoundRect(
        inset,
        inset.height() / 2,
        inset.height() / 2,
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = ring
            color = ROUNDEL_INK
        },
    )
    val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    faces.forEachIndexed { i, face ->
        fill.color = parseColor(face.color)
        canvas.drawCircle(pad + bead / 2 + i * (bead + gap), height / 2, bead / 2, fill)
    }
    return bitmap
}

/** How far a major station's name sits from its capsule's middle, in ems: half the capsule ([BusMapProps.COUNT] beads) and a little. */
private fun railDotNameOffset(): Expression {
    val count = Expression.toNumber(Expression.get(BusMapProps.COUNT))
    fun em(dp: Float) = Expression.literal(dp / RAIL_NAME_SIZE)
    val height = RAIL_BEAD_DP + 2 * RAIL_CAPSULE_PAD_DP
    return Expression.switchCase(
        Expression.eq(count, Expression.literal(0)),
        em(height / 2 + RAIL_NAME_GAP_DP),
        Expression.sum(
            Expression.product(count, em((RAIL_BEAD_DP + RAIL_BEAD_GAP_DP) / 2)),
            em(-RAIL_BEAD_GAP_DP / 2 + RAIL_CAPSULE_PAD_DP + RAIL_NAME_GAP_DP),
        ),
    )
}

/**
 * How far a station's name sits from its roundels' middle, in ems, with them drawn at [scale]: half
 * the row they make (as many as [BusMapProps.COUNT], or none for the plain ring) and a little.
 */
private fun railNameOffset(scale: Float): Expression {
    val count = Expression.toNumber(Expression.get(BusMapProps.COUNT))
    fun em(dp: Float) = Expression.literal(dp / RAIL_NAME_SIZE)
    return Expression.switchCase(
        Expression.eq(count, Expression.literal(0)),
        em(ROUNDEL_DP * PLAIN_SCALE / 2 * scale + RAIL_NAME_GAP_DP),
        // A row of n is n roundels and n - 1 gaps across.
        Expression.sum(
            Expression.product(count, em((ROUNDEL_DP + ROUNDEL_GAP_DP) / 2 * scale)),
            em(-ROUNDEL_GAP_DP / 2 * scale + RAIL_NAME_GAP_DP),
        ),
    )
}

/**
 * [faces] side by side as one image, each the app's station roundel at its small size
 * (core/ui's `LineRoundel` with `station`, [RoundelSize.SM]): a white face, the line's ring, the
 * line's prefix stacked over the stop's position. None is an unnumbered station's plain ring.
 */
private fun roundelImage(faces: List<RailRoundel>, density: Float, typeface: Typeface?): Bitmap {
    val diameter = ROUNDEL_DP * density
    val gap = ROUNDEL_GAP_DP * density
    val count = faces.size.coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(
        (count * diameter + (count - 1) * gap).roundToInt().coerceAtLeast(1),
        diameter.roundToInt().coerceAtLeast(1),
        Bitmap.Config.ARGB_8888,
    )
    val canvas = Canvas(bitmap)
    val ring = ROUNDEL_RING_DP * density
    val face = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = ring
    }
    val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ROUNDEL_INK
        textAlign = Paint.Align.CENTER
        this.typeface = typeface ?: Typeface.DEFAULT_BOLD
    }
    val r = diameter / 2
    val plain = faces.isEmpty()
    for (i in 0 until count) {
        val cx = r + i * (diameter + gap)
        val cy = r
        val radius = if (plain) r * PLAIN_SCALE else r
        canvas.drawCircle(cx, cy, radius, face)
        stroke.color = if (plain) ROUNDEL_INK else parseColor(faces[i].color)
        canvas.drawCircle(cx, cy, radius - ring / 2, stroke)
        if (plain) continue
        // Each line laid out as tall as its cap height, the digits' too, the gap between them alone.
        val (prefix, position) = splitStationNumber(faces[i].number)
        val prefixSize = ROUNDEL_PREFIX_DP * density
        val positionSize = ROUNDEL_POSITION_DP * density
        val prefixHeight = if (prefix.isEmpty()) 0f else prefixSize * CAP_SHARE
        val positionHeight = positionSize * CAP_SHARE
        val stackGap = if (prefix.isEmpty()) 0f else ROUNDEL_STACK_GAP_DP * density
        var top = cy - (prefixHeight + stackGap + positionHeight) / 2
        if (prefix.isNotEmpty()) {
            ink.textSize = prefixSize
            canvas.drawText(prefix, cx, top + prefixHeight, ink)
            top += prefixHeight + stackGap
        }
        ink.textSize = positionSize
        canvas.drawText(position, cx, top + positionHeight, ink)
    }
    return bitmap
}

/** `#RRGGBB` as a colour int; the roundel ink for one that doesn't parse. */
private fun parseColor(hex: String): Int =
    runCatching { android.graphics.Color.parseColor(hex) }.getOrDefault(ROUNDEL_INK)

/**
 * The network as it shows, or with [debug] the debug panel's lines in its place, the bundles' halte
 * marks going with the network; line [code] drawn alone over the rest faded, or null for all of
 * them as they are.
 */
private fun showLines(style: Style, debug: Boolean, code: String?, dots: StreetsDots = StreetsDots.ALL) {
    fun visible(shown: Boolean) = PropertyFactory.visibility(if (shown) Property.VISIBLE else Property.NONE)
    val faded = PropertyFactory.lineOpacity(if (code != null) FADED_OPACITY else 1f)
    for (id in LINE_LAYERS + CASING_LAYERS) style.getLayer(id)?.setProperties(visible(!debug), faded)
    for (id in listOf(BAR_LAYER, MARK_DOT_LAYER)) style.getLayer(id)?.setProperties(visible(!debug && dots.haltes))
    for (id in listOf(HALTE_LAYER, HALTE_NAME_LAYER)) style.getLayer(id)?.setProperties(visible(dots.haltes))
    for (id in listOf(RAIL_LAYER, RAIL_DOT_LAYER, RAIL_MINOR_DOT_LAYER)) style.getLayer(id)?.setProperties(visible(dots.stations))
    style.getLayer(DEBUG_LAYER)?.setProperties(visible(debug), faded)
    for ((id, shown) in listOf(ISOLATE_LAYER to !debug, ISOLATE_LAYER + CASING_SUFFIX to !debug, DEBUG_ISOLATE_LAYER to debug)) {
        (style.getLayer(id) as? LineLayer)?.apply {
            if (code != null) setFilter(Expression.eq(Expression.get(BusMapProps.CODE), Expression.literal(code)))
            setProperties(visible(shown && code != null))
        }
    }
}

/** shirase's empty layer, just under the basemap's first label: where an app's overlays go. */
private const val OVERLAY_SLOT = "commute-overlay"

/** shirase's landmarks, its stations among them ([RAIL_POI_KIND]). */
private const val BASEMAP_POIS_LAYER = "pois"

/** The map's roundels against core/ui's [RoundelSize.SM]: smaller, the streets' names their size. */
private const val ROUNDEL_SHRINK = 0.8f

/** A station roundel, as core/ui's [RoundelSize.SM] shrunk: across, its ring, its number's two lines and the gap between. */
private const val ROUNDEL_DP = 24f * ROUNDEL_SHRINK
private const val ROUNDEL_RING_DP = 3f * ROUNDEL_SHRINK
private const val ROUNDEL_PREFIX_DP = 6.5f * ROUNDEL_SHRINK
private const val ROUNDEL_POSITION_DP = 9f * ROUNDEL_SHRINK
private const val ROUNDEL_STACK_GAP_DP = 1.25f * ROUNDEL_SHRINK

/** Between an interchange's roundels. */
private const val ROUNDEL_GAP_DP = 1.5f

/** PT Sans's cap height, its digits' too, as a share of its size: core/ui's STACKED_LINE_SHARE. */
private const val CAP_SHARE = 0.7f

/** core/ui's roundel ink, on the white face. */
private const val ROUNDEL_INK = 0xFF0F172A.toInt()

/** An unnumbered station's ring, smaller than a numbered one's. */
private const val PLAIN_SCALE = 0.6f

/** The roundels at [RAIL_ROUNDELS_MIN_ZOOM], as a share of their size from z15. */
private const val ROUNDEL_SCALE_13 = 0.8f

/** A station's name, and the room between it and its roundels. */
private const val RAIL_NAME_SIZE = 12f
private const val RAIL_NAME_GAP_DP = 3f

private const val LINES_SOURCE = "peta-bus-lines"
private const val ROUTES_SOURCE = "peta-bus-routes"
private const val AUI_ROUTE_LAYER = "peta-bus-aui-routes"
private const val BRT_ROUTE_LAYER = "peta-bus-brt-routes"
private const val ISOLATE_LAYER = "peta-bus-alone"

/** The debug panel's raw or processed lines: their source, every line on it, and a line alone over them. */
private const val DEBUG_SOURCE = "peta-bus-debug"
private const val DEBUG_LAYER = "peta-bus-debug"
private const val DEBUG_ISOLATE_LAYER = "peta-bus-debug-alone"
private const val DEBUG_W_10 = 1.2f
private const val DEBUG_W_14 = 2f
private const val DEBUG_W_18 = 3.5f
private const val DEBUG_ALONE_SCALE = 2f

/** Raw's source before its lines are read. */
private const val EMPTY_COLLECTION = """{"type":"FeatureCollection","features":[]}"""
private const val WASH_LAYER = "peta-bus-wash"
private const val MARKS_SOURCE = "peta-bus-marks"
private const val BAR_LAYER = "peta-bus-bars"
private const val MARK_DOT_LAYER = "peta-bus-mark-dots"
private const val BAR_IMAGE = "peta-bus-bar-"

/** Bars are drawn for bundles up to this many lines, the widest on the network with room to spare. */
private const val MAX_BAR_LINES = 32

/** A halte bar at z15, in dp: as thick as a line and a half, reaching a little past the bundle's edges. */
private const val BAR_THICK_DP = 5f
private const val BAR_OVERHANG_DP = 2f
private const val BAR_OUTLINE_DP = 1.2f
private const val BAR_OUTLINE = 0xFF1E293B.toInt()
private const val MARK_OUTLINE = "#1E293B"

/** The wash over the basemap, light and dark: enough to quiet it, not to hide it. */
private const val WASH_LIGHT = "#FFFFFF"
private const val WASH_DARK = "#0F172A"
private const val WASH_OPACITY = 0.35f

/** Where the bundled network gives way to each line on its own streets. */
private const val STREET_ZOOM = 16f
private const val ROUTE_W_16 = 2.5f
private const val ROUTE_W_18 = 4f
private const val ALONE_W_10 = 2.5f
private const val ALONE_W_14 = 4.5f
private const val ALONE_W_18 = 8f

/** How much of the other lines shows under one drawn alone. */
private const val FADED_OPACITY = 0.15f
private const val HALTES_SOURCE = "peta-bus-haltes"
private const val RAIL_SOURCE = "peta-bus-rail"
private const val AUI_LAYER = "peta-bus-aui"
private const val BRT_LAYER = "peta-bus-brt"
private const val TRUNK_LAYER = "peta-bus-trunks"

/** Every layer drawing lines, faded when one is drawn alone. */
private val LINE_LAYERS = listOf(TRUNK_LAYER, AUI_LAYER, BRT_LAYER, AUI_ROUTE_LAYER, BRT_ROUTE_LAYER)

/** Each line layer's casing ([LINE_FILL], [CASING_DP]), and the alone line's, its id with this after. */
private const val CASING_SUFFIX = "-casing"
private val CASING_LAYERS = (LINE_LAYERS + ISOLATE_LAYER).map { it + CASING_SUFFIX }

/** A bundled line's share of its place across the street; the rest, a hairline of casing between. */
private const val LINE_FILL = 0.8f

/** How far a line's casing reaches past its edge, in dp. */
private const val CASING_DP = 1f

/** The casing: the ground under the wash (shirase's earth, #314256 in dark, with [WASH_DARK] over it), light and dark. */
private const val CASING_LIGHT = "#FFFFFF"
private const val CASING_DARK = "#253347"
private const val HALTE_LAYER = "peta-bus-haltes"
private const val HALTE_NAME_LAYER = "peta-bus-halte-names"
private const val RAIL_LAYER = "peta-bus-rail"

/**
 * The rail stations zoomed out, as bead capsules: the major ones, named, and the rest; each one's
 * image is its roundels' ([BusMapProps.ICON]) after [RAIL_DOT_IMAGE]. A bead, between two, round
 * the beads inside the capsule, and the capsule's ring.
 */
private const val RAIL_DOT_LAYER = "peta-bus-rail-dots"
private const val RAIL_MINOR_DOT_LAYER = "peta-bus-rail-minor-dots"
private const val RAIL_DOT_IMAGE = "dot-"
private const val RAIL_BEAD_DP = 5f
private const val RAIL_BEAD_GAP_DP = 1.5f
private const val RAIL_CAPSULE_PAD_DP = 2f
private const val RAIL_CAPSULE_RING_DP = 1.5f

/** From here in, every rail station as its roundels; out from here, as dots, from [RAIL_MINOR_DOTS_MIN_ZOOM] the minor ones too. */
private const val RAIL_ROUNDELS_MIN_ZOOM = 13f
private const val RAIL_MINOR_DOTS_MIN_ZOOM = 11f

/** shirase's glyphs: PT Sans, as JakLingko's wayfinding. A stack is one font. */
private const val LABEL_FONT = "PT Sans Regular"

private const val HALTE_MIN_ZOOM = 12.5f

/** Where halte marks come in on the bundles: city zoom, as Transit marks every stop. */
private const val MARKS_MIN_ZOOM = 11.5f

/** Where every line comes in; further out, the trunk koridors alone. */
private const val ALL_LINES_MIN_ZOOM = 13f

/** How much bolder the trunks are drawn, zoomed out, than every line closer in: none while only trunks are drawn. */
private const val TRUNK_SCALE = 1f

/** Every line's width, in px by zoom; a stretch's offset is its slot times this. */
private const val LINE_W_10 = 1.0f
private const val LINE_W_13 = 2.0f
private const val LINE_W_15 = BUS_LINE_W_15_DP
private const val LINE_W_18 = 6.0f
private const val HALTE_NAME_MIN_ZOOM = 15f
private const val HALTE_FILL = "#FFFFFF"
private const val HALTE_STROKE = "#334155"
private const val HALTE_TEXT = "#1E293B"
private const val HALTE_HALO = "#FFFFFF"
private const val HALTE_FILL_DARK = "#1E293B"
private const val HALTE_STROKE_DARK = "#E2E8F0"
private const val HALTE_TEXT_DARK = "#E2E8F0"
private const val HALTE_HALO_DARK = "#0F172A"

/** A finger's reach around a tap, in dp, for a halte's small dot. */
private const val TAP_SLOP_DP = 16f

/** shirase's extract (`apps/shirase/scripts/extract.sh`): the camera stays over it. */
private val JABODETABEK: LatLngBounds = LatLngBounds.from(-5.85, 107.3, -6.8, 105.9)
private const val MIN_ZOOM = 9.0
private const val MAX_ZOOM = 19.0
private const val RIDER_ZOOM = 15.0
private const val RECENTER_MILLIS = 600

/** Bundaran HI, with the koridors around it, before the rider's whereabouts are known. */
private val DEFAULT_CAMERA = StreetsCamera(latitude = -6.1950, longitude = 106.8230, zoom = 12.5)

/**
 * A halte bar across a bundle of [lines] at z15, as the image the bar layer draws: a white rounded
 * bar with a dark outline, Transit's mark for a stop several lines share. Lying along x, turned to
 * the street by the layer. Drawn at the screen's [density], which MapLibre reads off the bitmap.
 */
private fun barImage(lines: Int, density: Float): Bitmap {
    val lengthDp = lines * LINE_W_15 + 2 * BAR_OVERHANG_DP
    val width = (lengthDp * density).roundToInt().coerceAtLeast(1)
    val height = (BAR_THICK_DP * density).roundToInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val inset = BAR_OUTLINE_DP * density / 2
    val rect = RectF(inset, inset, width - inset, height - inset)
    val radius = rect.height() / 2
    canvas.drawRoundRect(rect, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE })
    canvas.drawRoundRect(
        rect,
        radius,
        radius,
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = BAR_OUTLINE_DP * density
            color = BAR_OUTLINE
        },
    )
    return bitmap
}
