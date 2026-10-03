package id.shiorilabs.commute

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class CommuteApplication : Application() {

    @Inject
    lateinit var queryClient: QueryClient

    @Inject
    @ApplicationScope
    lateinit var applicationScope: CoroutineScope

    override fun onCreate() {
        super.onCreate()
        // Off the launch path: the cache is trimmed once per launch, whenever the disk gets to it.
        applicationScope.launch { queryClient.prune() }
    }
}
