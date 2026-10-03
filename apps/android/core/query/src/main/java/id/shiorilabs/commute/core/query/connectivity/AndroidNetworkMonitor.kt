package id.shiorilabs.commute.core.query.connectivity

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.connectivity.NetworkMonitor
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import javax.inject.Inject

/**
 * [NetworkMonitor] over the default network's capabilities: as loose as the browser's
 * `navigator.onLine`, and the same test `rememberIsOffline` in `:core:ui` makes for its banner.
 */
internal class AndroidNetworkMonitor @Inject constructor(
    @ApplicationContext context: Context,
) : NetworkMonitor {

    private val connectivity = context.getSystemService(ConnectivityManager::class.java)

    override val isOnline: Flow<Boolean> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                trySend(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
            }

            override fun onLost(network: Network) {
                trySend(false)
            }
        }
        trySend(connectivity.isOnline())
        connectivity.registerDefaultNetworkCallback(callback)
        awaitClose { connectivity.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()

    private fun ConnectivityManager.isOnline(): Boolean =
        getNetworkCapabilities(activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
}
