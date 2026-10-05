package id.shiorilabs.commute.feature.journey.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.journey.replan.JourneyTripReplanner
import id.shiorilabs.commute.feature.trip.TripReplanner

@Module
@InstallIn(SingletonComponent::class)
abstract class JourneyTripModule {

    @Binds
    abstract fun bindTripReplanner(impl: JourneyTripReplanner): TripReplanner
}
