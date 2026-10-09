package id.shiorilabs.commute.feature.trip.wear

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.graphics.toColorInt
import androidx.core.net.toUri
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.datastore.DeveloperPreferencesRepository
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.wearable.WearLine
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.core.wearable.WearTrip
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.runtime.FinishedTrip
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToLong

/**
 * Hands the running trip to the watch: a data item while one runs, its last state once it arrives
 * (for the watch's "udah sampai"), and nothing once it is stopped. The Data Layer only sends an item
 * that changed, and the trip is trimmed to what the watch draws, so a fix that moves nothing it
 * shows sends nothing.
 *
 * A trip just started also opens the watch app, as Maps opens its navigation there, unless
 * "Buka Otomatis di Jam" is off.
 */
@Singleton
class WearTripSync @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val controller: TripControllerImpl,
    private val lines: LineRepository,
    private val developer: DeveloperPreferencesRepository,
    private val clock: Clock,
    @param:ApplicationScope private val scope: CoroutineScope,
) {

    private val started = AtomicBoolean(false)

    private val dataClient by lazy { Wearable.getDataClient(context) }

    /** Follows the trip from now on; once per process, whoever asks first. */
    fun start() {
        if (!started.compareAndSet(false, true)) return
        val trips = combine(controller.active, controller.finished, ::forWatch)
            .distinctUntilChanged()
            .shareIn(scope, SharingStarted.Eagerly, replay = 1)
        scope.launch { trips.collectLatest(::publish) }
        // Not collectLatest: the trip's next step lands within moments of its start, and mustn't
        // cancel the opening.
        scope.launch { trips.collect(::openIfJustStarted) }
    }

    /** The start of the trip the watch app was last opened for, so each trip opens it once. */
    private var openedFor: Instant? = null

    private suspend fun openIfJustStarted(trip: WearTrip?) {
        if (trip == null || trip.finished != null) return
        val startedAt = trip.state.startedAt
        if (!justStarted(startedAt, openedFor, clock.instant())) return
        openedFor = startedAt
        if (!developer.watchAutoOpen.first()) return
        runCatching {
            val watches = Wearable.getCapabilityClient(context)
                .getCapability(WearPaths.WEAR_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
                .await()
                .nodes
            if (watches.isEmpty()) return@runCatching
            val intent = Intent(Intent.ACTION_VIEW, WearPaths.WATCH_LINK.toUri()).addCategory(Intent.CATEGORY_BROWSABLE)
            val helper = RemoteActivityHelper(context)
            watches.forEach { helper.startRemoteActivity(intent, it.id) }
        }
    }

    private fun forWatch(active: ActiveTrip?, finished: FinishedTrip?): WearTrip? {
        if (active != null) return active.toWear(finished = null)
        val arrived = finished?.takeIf {
            it.reason == FinishReason.ARRIVED && clock.instant().isBefore(it.at.plus(ARRIVED_KEPT))
        } ?: return null
        return arrived.trip.toWear(finished = FinishReason.ARRIVED)
    }

    private fun ActiveTrip.toWear(finished: FinishReason?): WearTrip {
        val known = lines.cachedLines().orEmpty()
        val names = plan.rideIndices.map { plan.ride(it).line }.distinct().mapNotNull { key ->
            val line = known[key] ?: return@mapNotNull null
            val color = runCatching { line.colorCode.toColorInt() }.getOrNull() ?: return@mapNotNull null
            key to WearLine(line.name, color)
        }.toMap()
        return WearTrip(plan.withoutShapes(), state.forWatch(), names, finished)
    }

    /** The watch only draws the trip; the hops' shapes are for placing fixes, on the phone alone. */
    private fun TripPlan.withoutShapes(): TripPlan =
        TripPlan(legs.map { leg -> if (leg is TripLeg.Ride) leg.copy(hopShapes = emptyList()) else leg })

    private suspend fun publish(trip: WearTrip?) {
        // No Wear OS app on the phone, or no Play services: there is no watch to tell.
        runCatching {
            if (trip == null) {
                dataClient.deleteDataItems(Uri.Builder().scheme(WEAR_SCHEME).path(WearPaths.TRIP).build()).await()
            } else {
                dataClient.putDataItem(PutDataRequest.create(WearPaths.TRIP).setData(trip.encode()).setUrgent()).await()
            }
        }
    }

    private companion object {

        const val WEAR_SCHEME = "wear"

        /** How long the watch keeps saying the trip arrived: about the walk out of the station. */
        val ARRIVED_KEPT: Duration = Duration.ofMinutes(10)
    }
}

/**
 * Whether a trip that started at [startedAt] should open the watch app now: one it wasn't opened for
 * yet ([openedFor]), started within [OPEN_WITHIN]. Not a trip picked back up as the app restarts
 * mid-ride, which would open it again out of nowhere.
 */
internal fun justStarted(startedAt: Instant, openedFor: Instant?, now: Instant): Boolean =
    startedAt != openedFor && Duration.between(startedAt, now) < OPEN_WITHIN

private val OPEN_WITHIN: Duration = Duration.ofMinutes(1)

/**
 * The state as the watch needs it: the engine's own bookkeeping dropped, and the position to a
 * twentieth of a stop, which is finer than the watch's ring can show.
 */
internal fun TripState.forWatch(): TripState = copy(
    confirmedPosition = 0.0,
    position = (position * POSITION_STEPS).roundToLong() / POSITION_STEPS,
    confirmedAt = null,
    firedAlerts = emptySet(),
    offRouteStrikes = 0,
    stopTimes = emptyMap(),
)

private const val POSITION_STEPS = 20.0
