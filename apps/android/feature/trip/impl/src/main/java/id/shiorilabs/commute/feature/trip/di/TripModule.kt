package id.shiorilabs.commute.feature.trip.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.trip.ActiveTripBar
import id.shiorilabs.commute.feature.trip.TripController
import id.shiorilabs.commute.feature.trip.presentation.ActiveTripBarImpl
import id.shiorilabs.commute.feature.trip.navigation.TripNavContribution
import id.shiorilabs.commute.feature.trip.runtime.ActiveTripFileStore
import id.shiorilabs.commute.feature.trip.runtime.AndroidTripRuntime
import id.shiorilabs.commute.feature.trip.runtime.DirectoryStopLocator
import id.shiorilabs.commute.feature.trip.runtime.StopLocator
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import id.shiorilabs.commute.feature.trip.runtime.TripRuntime
import id.shiorilabs.commute.feature.trip.runtime.TripStore
import id.shiorilabs.commute.feature.trip.startup.ActiveTripWarmup

@Module
@InstallIn(SingletonComponent::class)
abstract class TripModule {

    @Binds
    abstract fun bindTripController(impl: TripControllerImpl): TripController

    @Binds
    abstract fun bindTripStore(impl: ActiveTripFileStore): TripStore

    @Binds
    abstract fun bindTripRuntime(impl: AndroidTripRuntime): TripRuntime

    @Binds
    abstract fun bindActiveTripBar(impl: ActiveTripBarImpl): ActiveTripBar

    @Binds
    abstract fun bindStopLocator(impl: DirectoryStopLocator): StopLocator

    @Binds
    @IntoSet
    abstract fun bindActiveTripWarmup(impl: ActiveTripWarmup): StartupWarmup

    @Binds
    @IntoSet
    abstract fun bindTripNavContribution(impl: TripNavContribution): NavGraphContribution
}
