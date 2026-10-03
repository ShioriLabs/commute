package id.shiorilabs.commute.core.ui.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Whether the phone has no internet right now, for the "Kamu sedang offline" banners: the web's
 * `useNetworkStatus`.
 *
 * As loose as the browser's `navigator.onLine`: a default network that claims internet counts as
 * online, validated or not. The banner is a caveat about stale data, not a connectivity test, and a
 * captive portal that leaves every request failing already shows as a failed load.
 */
@Composable
fun rememberIsOffline(): State<Boolean> {
    val context = LocalContext.current
    val connectivity = remember(context) { context.getSystemService(ConnectivityManager::class.java) }
    val offline = remember(connectivity) { connectivity.offlineChanges() }
    return offline.collectAsStateWithLifecycle(initialValue = connectivity.isOffline())
}

private fun ConnectivityManager.isOffline(): Boolean =
    getNetworkCapabilities(activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true

private fun ConnectivityManager.offlineChanges(): Flow<Boolean> = callbackFlow {
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            trySend(!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
        }

        override fun onLost(network: Network) {
            trySend(true)
        }
    }
    trySend(isOffline())
    registerDefaultNetworkCallback(callback)
    awaitClose { unregisterNetworkCallback(callback) }
}.distinctUntilChanged()
