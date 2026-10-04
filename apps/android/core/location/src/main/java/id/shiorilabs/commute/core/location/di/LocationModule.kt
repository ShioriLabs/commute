package id.shiorilabs.commute.core.location.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.location.AndroidLocationClient
import id.shiorilabs.commute.core.location.LocationClient

@Module
@InstallIn(SingletonComponent::class)
abstract class LocationModule {

    @Binds
    abstract fun bindLocationClient(impl: AndroidLocationClient): LocationClient
}
