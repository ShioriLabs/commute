package id.shiorilabs.commute.feature.trip.runtime

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.core.location.LocationMode
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.TripLocationMode
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Keeps trip mode alive with the screen off and feeds it location: a foreground service of type
 * location, started only by the rider's tap (or the live screen reopening it), stopped when the trip
 * ends. It owns no trip logic; [TripControllerImpl] does, and asks for the location mode it needs.
 */
@AndroidEntryPoint
class TripService : Service() {

    @Inject
    lateinit var controller: TripControllerImpl

    @Inject
    lateinit var notifier: TripNotifier

    @Inject
    lateinit var location: LocationClient

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var wakeLock: PowerManager.WakeLock? = null
    private var collecting = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val trip = controller.active.value
        if (trip == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            ServiceCompat.startForeground(
                this,
                TripNotifier.PROGRESS_ID,
                notifier.progress(trip),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } catch (_: RuntimeException) {
            // No location permission any more, or started from the background: the trip carries on
            // by the clock, through its alarms.
            scope.launch { controller.trackingLost() }
            stopSelf()
            return START_NOT_STICKY
        }
        if (!collecting) {
            collecting = true
            follow()
        }
        return START_STICKY
    }

    private fun follow() {
        scope.launch {
            controller.active
                .map { it?.state?.locationMode }
                .distinctUntilChanged()
                .collectLatest { mode ->
                    when (mode) {
                        null -> stopSelf()
                        TripLocationMode.OFF -> emptyFlow<Unit>().collect {}
                        TripLocationMode.PRECISE -> location.updates(LocationMode.PRECISE).collect { controller.onFix(it) }
                        TripLocationMode.BALANCED -> location.updates(LocationMode.BALANCED).collect { controller.onFix(it) }
                    }
                }
        }
        scope.launch {
            controller.active
                .map { it?.let(::onFinalApproach) == true }
                .distinctUntilChanged()
                .collect { approaching -> if (approaching) holdWake() else releaseWake() }
        }
    }

    /** Between "siap-siap" and "turun": the stretch where an alert late by a doze is a missed stop. */
    private fun onFinalApproach(trip: ActiveTrip): Boolean {
        val leg = trip.state.legIndex
        return trip.state.phase == TripPhase.RIDING &&
            "${AlertKind.PREPARE.name}:$leg" in trip.state.firedAlerts &&
            "${AlertKind.ALIGHT.name}:$leg" !in trip.state.firedAlerts
    }

    private fun holdWake() {
        if (wakeLock?.isHeld == true) return
        wakeLock = getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
            ?.apply { acquire(MAX_WAKE_MILLIS) }
    }

    private fun releaseWake() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    override fun onDestroy() {
        // Stopped mid-trip (location turned off in settings, or gone), the trip carries on by the
        // clock with its notification still up; a trip that ended has taken it down already.
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
        releaseWake()
        scope.cancel()
        super.onDestroy()
    }

    private companion object {

        const val WAKE_LOCK_TAG = "commute:trip-approach"

        /** Ten minutes: a hop that takes longer than this is a train that stopped, not one arriving. */
        const val MAX_WAKE_MILLIS = 10 * 60 * 1000L
    }
}
