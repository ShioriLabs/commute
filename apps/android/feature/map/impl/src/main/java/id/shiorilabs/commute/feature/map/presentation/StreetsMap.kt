package id.shiorilabs.commute.feature.map.presentation

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.PointF
import android.graphics.RectF
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import id.shiorilabs.commute.feature.map.domain.BusMapProps
import id.shiorilabs.commute.feature.map.domain.GeoStop
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
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.Layer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource

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
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val tapSlop = with(LocalDensity.current) { TAP_SLOP_DP * density }
    val onStation by rememberUpdatedState(onStationTap)
    val onAnyTap by rememberUpdatedState(onTap)
    val onMove by rememberUpdatedState(onUserMove)

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
                val hit = map.queryRenderedFeatures(box, HALTE_LAYER, RAIL_LAYER)
                    .minByOrNull { feature ->
                        val point = feature.geometry() as? org.maplibre.geojson.Point ?: return@minByOrNull Float.MAX_VALUE
                        val s = map.projection.toScreenLocation(LatLng(point.latitude(), point.longitude()))
                        (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y)
                    }
                val stationId = hit?.getStringProperty(BusMapProps.STATION_ID) ?: return@addOnMapClickListener false
                onStation(stationId)
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
        addBusMap(style, busMap, dark)
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
private fun addBusMap(style: Style, busMap: BusMapLayer, dark: Boolean) {
    for (id in listOf(RAIL_LAYER, HALTE_NAME_LAYER, HALTE_LAYER, BRT_LAYER, AUI_LAYER, TRUNK_LAYER)) style.removeLayer(id)
    for (id in listOf(LINES_SOURCE, HALTES_SOURCE, RAIL_SOURCE)) style.removeSource(id)

    style.addSource(GeoJsonSource(LINES_SOURCE, busMap.geoJson.lines))
    style.addSource(GeoJsonSource(HALTES_SOURCE, busMap.geoJson.haltes))
    style.addSource(GeoJsonSource(RAIL_SOURCE, busMap.geoJson.rail))

    val color = Expression.get(BusMapProps.COLOR)
    val zoom = Expression.zoom()
    // One width for every line, and each stretch that many widths across from where it runs, so lines
    // sharing a street lie side by side as Transit draws them. [scale] widens the lot.
    fun width(scale: Float) = Expression.interpolate(
        Expression.linear(), zoom,
        Expression.stop(10, LINE_W_10 * scale), Expression.stop(13, LINE_W_13 * scale),
        Expression.stop(15, LINE_W_15 * scale), Expression.stop(18, LINE_W_18 * scale),
    )
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
        .apply { minZoom = ALL_LINES_MIN_ZOOM }
    val brt = lines(BRT_LAYER, BusMapProps.SLOT, Expression.eq(Expression.get(BusMapProps.KIND), Expression.literal("BRT")))
        .apply { minZoom = ALL_LINES_MIN_ZOOM }
    val haltes = CircleLayer(HALTE_LAYER, HALTES_SOURCE).withProperties(
        PropertyFactory.circleRadius(Expression.interpolate(Expression.linear(), zoom, Expression.stop(13, 2f), Expression.stop(16, 5f), Expression.stop(18, 7f))),
        PropertyFactory.circleColor(if (dark) HALTE_FILL_DARK else HALTE_FILL),
        PropertyFactory.circleStrokeColor(if (dark) HALTE_STROKE_DARK else HALTE_STROKE),
        PropertyFactory.circleStrokeWidth(1.5f),
    ).apply { minZoom = HALTE_MIN_ZOOM }
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
    val rail = CircleLayer(RAIL_LAYER, RAIL_SOURCE).withProperties(
        PropertyFactory.circleRadius(Expression.interpolate(Expression.linear(), zoom, Expression.stop(10, 2.5f), Expression.stop(14, 5f), Expression.stop(18, 8f))),
        PropertyFactory.circleColor(if (dark) RAIL_FILL_DARK else RAIL_FILL),
        PropertyFactory.circleStrokeColor(if (dark) RAIL_STROKE_DARK else RAIL_STROKE),
        PropertyFactory.circleStrokeWidth(2f),
    )
    for (layer: Layer in listOf(trunks, aui, brt, haltes, rail)) {
        if (style.getLayer(OVERLAY_SLOT) != null) style.addLayerBelow(layer, OVERLAY_SLOT) else style.addLayer(layer)
    }
    // Halte names over the whole style: under the basemap's labels they lost every collision to a
    // road's name, and a halte's name is what the layer is for.
    style.addLayer(names)
}

/** shirase's empty layer, just under the basemap's first label: where an app's overlays go. */
private const val OVERLAY_SLOT = "commute-overlay"

private const val LINES_SOURCE = "peta-bus-lines"
private const val HALTES_SOURCE = "peta-bus-haltes"
private const val RAIL_SOURCE = "peta-bus-rail"
private const val AUI_LAYER = "peta-bus-aui"
private const val BRT_LAYER = "peta-bus-brt"
private const val TRUNK_LAYER = "peta-bus-trunks"
private const val HALTE_LAYER = "peta-bus-haltes"
private const val HALTE_NAME_LAYER = "peta-bus-halte-names"
private const val RAIL_LAYER = "peta-bus-rail"

/** shirase's glyphs: PT Sans, as JakLingko's wayfinding. A stack is one font. */
private const val LABEL_FONT = "PT Sans Regular"

private const val HALTE_MIN_ZOOM = 12.5f

/** Where every line comes in; further out, the trunk koridors alone. */
private const val ALL_LINES_MIN_ZOOM = 13f

/** How much bolder the trunks are drawn, zoomed out, than every line closer in. */
private const val TRUNK_SCALE = 1.5f

/** Every line's width, in px by zoom; a stretch's offset is its slot times this. */
private const val LINE_W_10 = 1.0f
private const val LINE_W_13 = 2.0f
private const val LINE_W_15 = 3.5f
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
private const val RAIL_FILL = "#0F172A"
private const val RAIL_STROKE = "#FFFFFF"
private const val RAIL_FILL_DARK = "#F1F5F9"
private const val RAIL_STROKE_DARK = "#0F172A"

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
