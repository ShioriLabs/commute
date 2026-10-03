package id.shiorilabs.commute.feature.journey.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.journey.startup.SavedRoutesWarmup

@Module
@InstallIn(SingletonComponent::class)
abstract class JourneyStartupModule {

    @Binds
    @IntoSet
    abstract fun bindSavedRoutesWarmup(impl: SavedRoutesWarmup): StartupWarmup
}
