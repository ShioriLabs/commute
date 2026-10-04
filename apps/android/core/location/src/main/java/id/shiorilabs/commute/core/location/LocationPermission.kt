package id.shiorilabs.commute.core.location

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState

/** Both location permissions: the rider can still pick "approximate" in the system dialog. */
val LocationPermissions = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
)

/**
 * A function that asks for location while in use, and reports whether either level was granted.
 * Call it from a tap, never on its own: the app asks in context.
 */
@Composable
fun rememberLocationPermissionRequest(onResult: (granted: Boolean) -> Unit): () -> Unit {
    val callback = rememberUpdatedState(onResult)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        callback.value(result.values.any { it })
    }
    return { launcher.launch(LocationPermissions) }
}
