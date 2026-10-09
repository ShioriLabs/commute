package id.shiorilabs.commute

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import io.sentry.SentryOptions
import io.sentry.android.core.SentryAndroid
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
        // Before anything else, so a crash while the app is put together is reported too.
        initCrashReporting()
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

    /**
     * Crashes, ANRs and native crashes go to Sentry; nothing else does. No one is identified: no
     * install ID on events and no sessions (which carry one), no screenshots, no performance
     * tracing. Debug builds report too, under their own environment, as field tests run on them.
     */
    private fun initCrashReporting() {
        SentryAndroid.init(this) { options ->
            options.dsn = BuildConfig.SENTRY_DSN
            options.environment = BuildConfig.BUILD_TYPE
            options.isEnableAutoSessionTracking = false
            // A native crash inside the runtime reaches sentry-native as a bare abort(), without
            // its message or the threads' stacks; Android's tombstone, read on the next launch,
            // has both.
            options.isTombstoneEnabled = true
            options.beforeSend = SentryOptions.BeforeSendCallback { event, _ ->
                // Sentry fills in a random per-install ID as the user and as the device's ID; drop
                // both.
                event.user = null
                event.contexts.device?.id = null
                event
            }
        }
    }
}
