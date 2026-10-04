package id.shiorilabs.commute.core.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
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
 * phone.
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

        return withTimeoutOrNull(timeout.toMillis()) {
            suspendCancellableCoroutine { continuation ->
                val signal = CancellationSignal()
                continuation.invokeOnCancellation { signal.cancel() }
                val request = LocationRequest.Builder(0L)
                    .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                    .setDurationMillis(timeout.toMillis())
                    .build()
                manager.getCurrentLocation(provider, request, signal, context.mainExecutor) { location ->
                    continuation.resume(location?.toFix())
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
            LocationMode.PRECISE -> LocationRequest.Builder(PRECISE_INTERVAL.toMillis())
                .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(PRECISE_INTERVAL.toMillis() / 2)
            // Satellite-grade too, only less often: cell and Wi-Fi fixes on a moving train are
            // rarely within the few hundred metres a station match needs, so cheaper fixes would
            // cost battery and confirm nothing.
            LocationMode.BALANCED -> LocationRequest.Builder(BALANCED_INTERVAL.toMillis())
                .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(PRECISE_INTERVAL.toMillis())
        }.build()

        return callbackFlow {
            val listener = LocationListener { location -> trySend(location.toFix()) }
            try {
                manager.requestLocationUpdates(provider, request, context.mainExecutor, listener)
            } catch (_: SecurityException) {
                // Revoked between the check and the request: no fixes, as documented.
                close()
                return@callbackFlow
            }
            awaitClose { manager.removeUpdates(listener) }
        }
    }

    /** The fused provider where the device has it, else satellites, else the network. */
    private fun provider(manager: LocationManager): String? = when {
        manager.hasProvider(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
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
    )

    private companion object {

        /** A last-known fix this fresh and this good answers "where am I" without waiting. */
        val RECENT: Duration = Duration.ofMinutes(2)
        const val RECENT_ACCURACY_M = 200f

        val PRECISE_INTERVAL: Duration = Duration.ofSeconds(5)
        val BALANCED_INTERVAL: Duration = Duration.ofSeconds(30)
    }
}
