package id.shiorilabs.commute.feature.hub.data.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.hub.data.HubRepository
import id.shiorilabs.commute.feature.hub.data.impl.HubRepositoryImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class HubModule {

    @Binds
    abstract fun bindHubRepository(impl: HubRepositoryImpl): HubRepository
}
