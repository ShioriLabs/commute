package id.shiorilabs.commute.core.network.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.network.service.impl.CommuteServiceImpl
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class ServiceModule {

    @Binds
    @Singleton
    abstract fun bindCommuteService(impl: CommuteServiceImpl): CommuteService
}
