package id.shiorilabs.commute

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.startup.StartupWarmup
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class CommuteApplication : Application() {

    @Inject
    lateinit var queryClient: QueryClient

    @Inject
    lateinit var warmups: Set<@JvmSuppressWildcards StartupWarmup>

    @Inject
    @ApplicationScope
    lateinit var applicationScope: CoroutineScope

    override fun onCreate() {
        super.onCreate()
        applicationScope.launch {
            // First thing, while the splash plays: read what the first screen shows into memory, so
            // it is there when the screen asks, rather than asked for once the screen has drawn.
            warmups.map { warmup ->
                launch {
                    try {
                        warmup.warm()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        // A failed warm-up only costs the screen its head start.
                    }
                }
            }.joinAll()
            // Then, off the launch path, the cache is trimmed once per launch.
            queryClient.prune()
        }
    }
}
