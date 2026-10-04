package id.shiorilabs.commute.core.notification

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState

/**
 * A function that asks to post notifications and reports whether it may. Call it from a tap: the
 * app asks in context, when the rider starts something that notifies.
 */
@Composable
fun rememberNotificationPermissionRequest(onResult: (granted: Boolean) -> Unit): () -> Unit {
    val callback = rememberUpdatedState(onResult)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        callback.value(granted)
    }
    return { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }
}
