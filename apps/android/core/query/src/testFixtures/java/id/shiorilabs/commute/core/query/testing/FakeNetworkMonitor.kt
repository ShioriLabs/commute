package id.shiorilabs.commute.core.query.testing

import id.shiorilabs.commute.core.connectivity.NetworkMonitor
import kotlinx.coroutines.flow.MutableStateFlow

/** A [NetworkMonitor] a test switches by hand. Online unless told otherwise. */
class FakeNetworkMonitor(online: Boolean = true) : NetworkMonitor {

    override val isOnline = MutableStateFlow(online)
}
