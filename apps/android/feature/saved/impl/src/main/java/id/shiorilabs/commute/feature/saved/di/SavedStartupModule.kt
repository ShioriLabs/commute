package id.shiorilabs.commute.feature.saved.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.saved.startup.HomeWarmup

@Module
@InstallIn(SingletonComponent::class)
abstract class SavedStartupModule {

    @Binds
    @IntoSet
    abstract fun bindHomeWarmup(impl: HomeWarmup): StartupWarmup
}
