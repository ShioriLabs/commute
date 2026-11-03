package id.shiorilabs.commute.feature.trip.runtime

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.core.location.LocationMode
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLocationMode
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.time.Clock
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

    @Inject
    lateinit var motion: MotionTracker

    @Inject
    lateinit var rawGnss: RawGnssRecorder

    @Inject
    lateinit var recorder: SensorRecorder

    @Inject
    lateinit var developerPreferences: DeveloperPreferencesRepository

    @Inject
    lateinit var clock: Clock

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var wakeLock: PowerManager.WakeLock? = null
    private var collecting = false

    /** The leg being recorded, if any. */
    private var recorded: RecordedLeg? = null

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
            // A new trip during the last one's recorded minute: the service is the trip's again.
            notifier.cancelRecording()
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
                        null -> if (recorded?.detailed == true) recordTail() else stopSelf()
                        TripLocationMode.OFF -> emptyFlow<Unit>().collect {}
                        TripLocationMode.PRECISE -> location.updates(LocationMode.PRECISE).collect { motion.onFix(it); controller.onFix(it) }
                        TripLocationMode.BALANCED -> location.updates(LocationMode.BALANCED).collect { motion.onFix(it); controller.onFix(it) }
                    }
                }
        }
        scope.launch {
            controller.active
                .map { it?.let(::onFinalApproach) == true }
                .distinctUntilChanged()
                .collect { approaching -> if (approaching) holdWake() else releaseWake() }
        }
        scope.launch {
            // Each leg is a recording of its own. Once the trip has ended, a detailed one stays open
            // for [recordTail] to close.
            combine(controller.active, developerPreferences.imuSpeed, developerPreferences.detailedRecording) { trip, imu, detailed ->
                recordedLeg(trip, imu, detailed) ?: recorded?.takeIf { trip == null && it.detailed }
            }
                .distinctUntilChanged { a, b -> a?.legIndex == b?.legIndex && a?.motion == b?.motion && a?.detailed == b?.detailed }
                .collect(::record)
        }
        scope.launch {
            // The stop the train stands at, for the motion sensors to feel it leave: only while they run.
            val running = motion.live.map { it != null && !it.unavailable }.distinctUntilChanged()
            combine(controller.active, running) { trip, on ->
                trip?.takeIf { on }?.let { TripEngine.awaitingDeparture(it.plan, it.state, clock.instant()) }
            }
                .distinctUntilChanged()
                .collect { motion.arm(it) }
        }
        scope.launch {
            motion.departures.collect { controller.onDeparted(it.legIndex, it.stopIndex, it.at) }
        }
    }

    /** The last leg's recording closed, and [leg]'s opened, with what it reads running. */
    private fun record(leg: RecordedLeg?) {
        motion.stop()
        rawGnss.stop()
        recorder.stop()
        recorded = leg
        if (leg == null) return
        recorder.start(leg.ride, motion = leg.motion, detailed = leg.detailed, phase = controller.active.value?.state?.phase)
        if (leg.motion) motion.start()
        if (leg.detailed) rawGnss.start()
    }

    /**
     * "Rekaman Detail" after the trip ended: a minute more of the rider getting off, under a
     * notification of its own as the trip's has gone, then the service stops. A trip started
     * meanwhile cancels it, and its first leg's recording closes this one.
     */
    private suspend fun recordTail() {
        try {
            ServiceCompat.startForeground(this, TripNotifier.RECORDING_ID, notifier.recording(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (_: RuntimeException) {
            record(null)
            stopSelf()
            return
        }
        notifier.cancelProgress()
        motion.stopLogging()
        delay(RECORDING_TAIL)
        record(null)
        stopSelf()
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
        record(null)
        notifier.cancelRecording()
        scope.cancel()
        super.onDestroy()
    }

    private companion object {

        const val WAKE_LOCK_TAG = "commute:trip-approach"

        /** "Rekaman Detail" past the end of a trip: the rider off the train and out of the station's first steps. */
        const val RECORDING_TAIL = 60_000L

        /** Ten minutes: a hop that takes longer than this is a train that stopped, not one arriving. */
        const val MAX_WAKE_MILLIS = 10 * 60 * 1000L
    }
}
