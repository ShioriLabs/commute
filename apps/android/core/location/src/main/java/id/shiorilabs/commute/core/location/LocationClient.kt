package id.shiorilabs.commute.core.location

import id.shiorilabs.commute.core.geo.GeoPoint
import kotlinx.coroutines.flow.Flow
import java.time.Duration
import java.time.Instant

/** One location reading. */
data class Fix(
    val point: GeoPoint,
    /** Radius of 68% confidence, in metres. */
    val accuracyM: Float,
    val at: Instant,
    /** Ground speed in metres a second, as the satellites measured it; `null` when they didn't. */
    val speedMps: Float? = null,
    /** How far [speedMps] may be off, in metres a second (68%). */
    val speedAccMps: Float? = null,
    /** Direction of travel, degrees clockwise from true north; `null` when the satellites didn't say. */
    val bearingDeg: Float? = null,
    /** How far [bearingDeg] may be off, in degrees (68%). */
    val bearingAccDeg: Float? = null,
    /** When it was taken on the monotonic clock motion sensors also stamp with (`elapsedRealtimeNanos`). */
    val elapsedNanos: Long? = null,
)

/** How hard to look: more often and more precisely costs battery. */
enum class LocationMode {
    /** Every few seconds, satellite-grade: the approach to a stop the rider gets off at. */
    PRECISE,

    /** About twice a minute: the middle of a long ride. */
    BALANCED,
}

/**
 * The device's location, while the app is allowed it. Nothing here asks for the permission; callers
 * check [hasPermission] and ask in context. Every reading stays on the device.
 */
interface LocationClient {

    /** Whether fine or coarse location is granted right now. */
    fun hasPermission(): Boolean

    /**
     * Where the device is now, or `null` without permission, with location off, or when nothing
     * answers within [timeout]. A recent enough last-known fix answers at once.
     */
    suspend fun current(timeout: Duration = Duration.ofSeconds(10)): Fix?

    /**
     * Fixes for as long as it is collected, at the rate [mode] asks for. Empty without permission or
     * a provider; it never throws for either.
     */
    fun updates(mode: LocationMode): Flow<Fix>
}
