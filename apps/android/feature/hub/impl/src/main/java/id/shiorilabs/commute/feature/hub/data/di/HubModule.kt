package id.shiorilabs.commute.feature.hub.data.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.hub.data.HubDirectory
import id.shiorilabs.commute.feature.hub.data.HubRepository
import id.shiorilabs.commute.feature.hub.data.impl.HubDirectoryImpl
import id.shiorilabs.commute.feature.hub.data.impl.HubRepositoryImpl
import id.shiorilabs.commute.feature.hub.presentation.HubSheet
import id.shiorilabs.commute.feature.hub.presentation.HubSheetImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class HubModule {

    @Binds
    abstract fun bindHubRepository(impl: HubRepositoryImpl): HubRepository

    /** Every hub, for the map's `HUB-…` tap targets. */
    @Binds
    abstract fun bindHubDirectory(impl: HubDirectoryImpl): HubDirectory

    /** The hub page in the map's sheet. */
    @Binds
    abstract fun bindHubSheet(impl: HubSheetImpl): HubSheet
}
