package id.shiorilabs.commute.di

import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.Multibinds
import id.shiorilabs.commute.core.startup.StartupWarmup

/** Declares the warm-up set, so a build with no feature binding one still has an (empty) set. */
@Module
@InstallIn(SingletonComponent::class)
abstract class StartupModule {

    @Multibinds
    abstract fun startupWarmups(): Set<StartupWarmup>
}
