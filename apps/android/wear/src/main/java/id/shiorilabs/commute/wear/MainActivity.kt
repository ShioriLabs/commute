package id.shiorilabs.commute.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    /**
     * One connection to the Data Layer for the screen and the Ongoing Activity both, kept a few
     * seconds past the app leaving the screen, so a glance back doesn't reconnect.
     */
    private val trip by lazy {
        WearTripRepository(this).trip.shareIn(lifecycleScope, SharingStarted.WhileSubscribed(SHARE_GRACE_MS), replay = 1)
    }
    private val phone by lazy { PhoneLink(this) }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WatchApp(trip, phone) }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        // A trip that started before the watch app was installed, or before the permission was
        // given, gets its Ongoing Activity here; the listener service keeps it after.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                trip.collect { trip ->
                    if (trip == null || trip.finished != null) {
                        TripOngoing.hide(this@MainActivity)
                    } else {
                        TripOngoing.show(this@MainActivity, trip)
                    }
                }
            }
        }
    }
}

private const val SHARE_GRACE_MS = 5_000L
