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
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val trips by lazy { WearTripRepository(this) }
    private val phone by lazy { PhoneLink(this) }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WatchApp(trips.trip, phone) }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        // A trip that started before the watch app was installed, or before the permission was
        // given, gets its Ongoing Activity here; the listener service keeps it after.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                trips.trip.collect { trip ->
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
