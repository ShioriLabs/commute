package id.shiorilabs.commute.core.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Light icons over a dark surface while it's up; the app's own again once the last such
 * surface has gone, so the trip bar leaving as the finished page's plate arrives can't darken
 * them under the plate. Set on every pass too, as the theme sets its own whenever it recomposes.
 */
@Composable
fun DarkStatusBarIcons() {
    val view = LocalView.current
    val controller = remember(view) {
        view.context.findActivity()?.window?.let { WindowCompat.getInsetsController(it, view) }
    }
    // What the app's own icons are once the last dark surface goes: dark ones on the light theme.
    val appIconsDark = !LocalDarkTheme.current
    SideEffect { controller?.isAppearanceLightStatusBars = false }
    DisposableEffect(controller, appIconsDark) {
        darkSurfaces++
        controller?.isAppearanceLightStatusBars = false
        onDispose {
            darkSurfaces--
            if (darkSurfaces == 0) controller?.isAppearanceLightStatusBars = appIconsDark
        }
    }
}

/** How many dark surfaces are up under the status bar. Only touched on the main thread. */
private var darkSurfaces = 0

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
