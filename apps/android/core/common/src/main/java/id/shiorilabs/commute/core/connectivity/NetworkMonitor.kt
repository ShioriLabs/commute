package id.shiorilabs.commute.core.connectivity

import kotlinx.coroutines.flow.Flow

/**
 * Whether the device has a network that claims internet access. Not whether the API answers: a
 * captive portal still reads as online, and its failure shows up as a fetch failure instead.
 */
interface NetworkMonitor {

    val isOnline: Flow<Boolean>
}
