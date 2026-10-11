package id.shiorilabs.commute.core.ext

import kotlinx.coroutines.flow.SharingStarted

private const val STOP_TIMEOUT_MS = 5_000L

/**
 * How a screen's state flow is shared: kept hot for five seconds after the last collector leaves,
 * which spans a rotation or a quick trip to another screen without restarting the upstream.
 */
val WhileUiSubscribed: SharingStarted = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS)
