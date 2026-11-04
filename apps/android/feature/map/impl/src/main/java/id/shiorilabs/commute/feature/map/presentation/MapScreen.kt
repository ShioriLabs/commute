package id.shiorilabs.commute.feature.map.presentation

import androidx.compose.foundation.AndroidExternalSurface
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.changedToDownIgnoreConsumed
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.map.R
import id.shiorilabs.commute.feature.map.domain.MapData
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The FDTJ integration map, edge to edge under the system bars, with a way back over it. */
@Composable
fun MapScreen(
    innerPadding: PaddingValues,
    viewModel: MapViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current

    // The artwork is drawn on white whatever the theme, as on the web.
    Box(Modifier.fillMaxSize().background(Color.White)) {
        when (val current = state) {
            is UIState.Success -> MapSurface(current.data, viewModel)
            is UIState.Error -> ProblemPanel(
                message = stringResource(R.string.map_load_failed),
                retryLabel = stringResource(R.string.map_retry),
                onRetry = viewModel::retry,
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
            )

            else -> CircularProgressIndicator(Modifier.align(Alignment.Center))
        }

        CommuteIconButton(
            onClick = { navigator.pop() },
            modifier = Modifier
                .padding(top = innerPadding.calculateTopPadding() + 8.dp, start = 12.dp)
                .size(40.dp)
                .shadow(2.dp, CircleShape)
                .background(MaterialTheme.colorScheme.surface, CircleShape),
        ) {
            Icon(
                imageVector = CommuteIcons.Back,
                contentDescription = stringResource(R.string.map_back),
                modifier = Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun MapSurface(data: MapData, viewModel: MapViewModel) {
    val navigator = LocalNavigator.current
    val density = LocalDensity.current.density
    val controller = remember(data) {
        MapController(
            data = data,
            repository = viewModel.repository,
            density = density,
            initialCamera = viewModel.camera,
            onStationTap = { stationId -> navigator.goTo(Route.Station(stationId)) },
        )
    }
    val supported by controller.isSupported.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val description = stringResource(R.string.map_description)

    DisposableEffect(controller) {
        onDispose {
            viewModel.camera = controller.camera
            controller.dispose()
        }
    }

    // Frames only while something moves or arrives; a still map draws nothing.
    LaunchedEffect(controller) {
        while (true) {
            controller.awaitInvalidation()
            while (withFrameNanos(controller::frame)) {
                // The next frame's step is already decided by this one.
            }
        }
    }

    // A while in the background and the tiles' memory goes back, as the web lets it go; back before
    // then and nothing is let go.
    var release by remember { mutableStateOf<Job?>(null) }
    LifecycleStartEffect(controller) {
        release?.cancel()
        release = null
        onStopOrDispose {
            release = scope.launch {
                delay(BACKGROUND_RELEASE_MS)
                controller.releaseTiles()
            }
        }
    }

    if (!supported) {
        Text(
            text = stringResource(R.string.map_unsupported),
            modifier = Modifier.fillMaxSize().padding(32.dp),
            style = MaterialTheme.typography.bodyLarge,
            color = Color.Black,
        )
        return
    }

    Box(Modifier.fillMaxSize().semantics { contentDescription = description }) {
        // A SurfaceView, so the system composites the frames itself. Behind a TextureView they waited
        // on the window's own redraws, and on a Galaxy S23 only about half of them reached the
        // screen. The cost: nothing in the window, a frosted sheet say, can blur the map.
        AndroidExternalSurface(modifier = Modifier.fillMaxSize(), isOpaque = true) {
            onSurface { surface, width, height ->
                controller.onSurface(surface, width, height)
                surface.onChanged { newWidth, newHeight -> controller.onResize(newWidth, newHeight) }
                surface.onDestroyed { controller.onSurfaceDestroyed() }
            }
        }
        // Over the surface rather than on it, so every touch reaches the camera first.
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(controller) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent()
                            if (event.type == PointerEventType.Exit) continue
                            for (change in event.changes) {
                                val id = change.id.value
                                val (x, y) = change.position
                                when {
                                    change.changedToDownIgnoreConsumed() -> controller.onPointerDown(id, x, y, change.uptimeMillis)
                                    change.changedToUpIgnoreConsumed() -> controller.onPointerUp(id, x, y, change.uptimeMillis)
                                    change.positionChanged() -> controller.onPointerMove(id, x, y, change.uptimeMillis)
                                }
                                change.consume()
                            }
                        }
                    }
                },
        )
    }
}

/** How long the map waits in the background before letting its tiles go: the web's 3 s. */
private const val BACKGROUND_RELEASE_MS = 3_000L
