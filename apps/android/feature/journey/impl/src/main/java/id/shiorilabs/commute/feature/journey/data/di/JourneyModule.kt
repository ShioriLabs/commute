package id.shiorilabs.commute.feature.journey.data.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.data.impl.JourneyRepositoryImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class JourneyModule {

    @Binds
    abstract fun bindJourneyRepository(impl: JourneyRepositoryImpl): JourneyRepository
}
