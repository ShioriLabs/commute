package id.shiorilabs.commute.core.location.testing

import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.core.location.LocationMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import java.time.Duration

/** A [LocationClient] a test drives: grant or not, answer [current], and push fixes. */
class FakeLocationClient(
    var granted: Boolean = true,
    var currentFix: Fix? = null,
) : LocationClient {

    val fixes = MutableSharedFlow<Fix>(extraBufferCapacity = 64)

    /** Every mode asked for, in order. */
    val modes = mutableListOf<LocationMode>()

    override fun hasPermission(): Boolean = granted

    override suspend fun current(timeout: Duration): Fix? = if (granted) currentFix else null

    override fun updates(mode: LocationMode): Flow<Fix> {
        modes += mode
        return fixes
    }
}
