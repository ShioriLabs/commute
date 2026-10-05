package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.feature.trip.ActiveTrip
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/** Where the running trip, and the one that last ended, are kept between process deaths. */
interface TripStore {

    fun read(): ActiveTrip?

    fun write(trip: ActiveTrip)

    fun clear()

    fun readFinished(): FinishedTrip?

    fun writeFinished(trip: FinishedTrip)

    fun clearFinished()
}

/** Everything the trip does outside itself: notifications, alarms and the location service. */
interface TripRuntime {

    fun showProgress(trip: ActiveTrip)

    fun alert(trip: ActiveTrip, alert: TripEffect.Alert)

    fun askStillOnRoute(trip: ActiveTrip)

    /** The ride waited for left at [missed] without the rider; [trip] now waits for the next. */
    fun rerouted(trip: ActiveTrip, missed: Instant)

    /** The trip is over: its notification goes. */
    fun finish()

    fun wakeAt(at: Instant)

    fun cancelWake()

    /**
     * Starts the foreground service that feeds fixes in. `false` when the system refuses, which it
     * does when the app is in the background (a restart after being killed): the trip carries on by
     * the clock until the rider opens it again.
     */
    fun startTracking(): Boolean

    fun stopTracking()
}

@Singleton
class ActiveTripFileStore @Inject constructor(private val file: ActiveTripStore) : TripStore {

    override fun read(): ActiveTrip? = file.read()

    override fun write(trip: ActiveTrip) = file.write(trip)

    override fun clear() {
        file.clear()
    }

    override fun readFinished(): FinishedTrip? = file.readFinished()

    override fun writeFinished(trip: FinishedTrip) = file.writeFinished(trip)

    override fun clearFinished() {
        file.clearFinished()
    }
}

@Singleton
class AndroidTripRuntime @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val notifier: TripNotifier,
    private val alarms: TripAlarms,
) : TripRuntime {

    override fun showProgress(trip: ActiveTrip) = notifier.showProgress(trip)

    override fun alert(trip: ActiveTrip, alert: TripEffect.Alert) = notifier.alert(trip, alert)

    override fun askStillOnRoute(trip: ActiveTrip) = notifier.askStillOnRoute(trip)

    override fun rerouted(trip: ActiveTrip, missed: Instant) = notifier.rerouted(trip, missed)

    override fun finish() = notifier.finish()

    override fun wakeAt(at: Instant) = alarms.wakeAt(at)

    override fun cancelWake() = alarms.cancel()

    override fun startTracking(): Boolean = try {
        ContextCompat.startForegroundService(context, Intent(context, TripService::class.java))
        true
    } catch (_: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException: started from the background.
        false
    } catch (_: SecurityException) {
        false
    }

    override fun stopTracking() {
        context.stopService(Intent(context, TripService::class.java))
    }
}
