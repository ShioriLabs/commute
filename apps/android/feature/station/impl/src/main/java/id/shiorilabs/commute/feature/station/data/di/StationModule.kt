package id.shiorilabs.commute.feature.station.data.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.data.impl.LineRepositoryImpl
import id.shiorilabs.commute.feature.station.data.impl.StationRepositoryImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class StationModule {

    @Binds
    abstract fun bindStationRepository(impl: StationRepositoryImpl): StationRepository

    @Binds
    abstract fun bindLineRepository(impl: LineRepositoryImpl): LineRepository
}
