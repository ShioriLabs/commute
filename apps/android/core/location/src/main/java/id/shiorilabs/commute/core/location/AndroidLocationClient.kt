package id.shiorilabs.commute.core.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.geo.GeoPoint
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Clock
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * [LocationClient] on the platform's own [LocationManager]: its fused provider where the device has
 * one, so there is no Play Services dependency and nothing about the rider's location leaves the
 * phone. Requests go through the AndroidX compat wrappers, which carry them back to Android 10.
 */
@Singleton
class AndroidLocationClient @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val clock: Clock,
) : LocationClient {

    private val manager: LocationManager? = context.getSystemService(LocationManager::class.java)

    override fun hasPermission(): Boolean =
        granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)

    @SuppressLint("MissingPermission") // Checked by hasPermission() first.
    override suspend fun current(timeout: Duration): Fix? {
        val manager = manager ?: return null
        if (!hasPermission()) return null
        val provider = provider(manager) ?: return null

        manager.getLastKnownLocation(provider)
            ?.takeIf { Duration.between(it.instant(), clock.instant()) < RECENT && it.accuracy <= RECENT_ACCURACY_M }
            ?.let { return it.toFix() }

        // A single satellite-grade update rather than getCurrentLocation, whose compat form takes no
        // request and so no quality.
        return withTimeoutOrNull(timeout.toMillis()) {
            suspendCancellableCoroutine { continuation ->
                val request = LocationRequestCompat.Builder(0L)
                    .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
                    .setDurationMillis(timeout.toMillis())
                    .setMaxUpdates(1)
                    .build()
                val listener = object : LocationListenerCompat {
                    override fun onLocationChanged(location: Location) {
                        LocationManagerCompat.removeUpdates(manager, this)
                        if (continuation.isActive) continuation.resume(location.toFix())
                    }
                }
                continuation.invokeOnCancellation { LocationManagerCompat.removeUpdates(manager, listener) }
                try {
                    LocationManagerCompat.requestLocationUpdates(manager, provider, request, context.mainExecutor, listener)
                } catch (_: SecurityException) {
                    // Revoked between the check and the request: no fix, as documented.
                    continuation.resume(null)
                }
            }
        }
    }

    @SuppressLint("MissingPermission") // Checked by hasPermission() first.
    override fun updates(mode: LocationMode): Flow<Fix> {
        val manager = manager ?: return emptyFlow()
        if (!hasPermission()) return emptyFlow()
        val provider = provider(manager) ?: return emptyFlow()

        val request = when (mode) {
            LocationMode.PRECISE -> LocationRequestCompat.Builder(PRECISE_INTERVAL.toMillis())
                .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(PRECISE_INTERVAL.toMillis() / 2)
            // Satellite-grade too, only less often: cell and Wi-Fi fixes on a moving train are
            // rarely within the few hundred metres a station match needs, so cheaper fixes would
            // cost battery and confirm nothing.
            LocationMode.BALANCED -> LocationRequestCompat.Builder(BALANCED_INTERVAL.toMillis())
                .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(PRECISE_INTERVAL.toMillis())
        }.build()

        return callbackFlow {
            val listener = LocationListenerCompat { location -> trySend(location.toFix()) }
            try {
                LocationManagerCompat.requestLocationUpdates(manager, provider, request, context.mainExecutor, listener)
            } catch (_: SecurityException) {
                // Revoked between the check and the request: no fixes, as documented.
                close()
                return@callbackFlow
            }
            awaitClose { LocationManagerCompat.removeUpdates(manager, listener) }
        }
    }

    /** The fused provider where the device has it (Android 12 on), else satellites, else the network. */
    private fun provider(manager: LocationManager): String? = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER) ->
            LocationManager.FUSED_PROVIDER
        manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        else -> null
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun Location.instant(): Instant = Instant.ofEpochMilli(time)

    private fun Location.toFix() = Fix(
        point = GeoPoint(latitude, longitude),
        accuracyM = if (hasAccuracy()) accuracy else Float.MAX_VALUE,
        at = instant(),
        speedMps = if (hasSpeed()) speed else null,
        speedAccMps = if (hasSpeedAccuracy()) speedAccuracyMetersPerSecond else null,
        bearingDeg = if (hasBearing()) bearing else null,
        bearingAccDeg = if (hasBearingAccuracy()) bearingAccuracyDegrees else null,
        elapsedNanos = elapsedRealtimeNanos,
    )

    private companion object {

        /** A last-known fix this fresh and this good answers "where am I" without waiting. */
        val RECENT: Duration = Duration.ofMinutes(2)
        const val RECENT_ACCURACY_M = 200f

        val PRECISE_INTERVAL: Duration = Duration.ofSeconds(5)
        val BALANCED_INTERVAL: Duration = Duration.ofSeconds(30)
    }
}
