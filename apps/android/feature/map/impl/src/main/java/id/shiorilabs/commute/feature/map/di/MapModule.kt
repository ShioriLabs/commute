package id.shiorilabs.commute.feature.map.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.map.data.AndroidMapStorage
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.data.MapStorage
import id.shiorilabs.commute.feature.map.data.impl.MapRepositoryImpl
import id.shiorilabs.commute.feature.map.navigation.MapNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class MapModule {

    @Binds
    abstract fun bindMapRepository(impl: MapRepositoryImpl): MapRepository

    @Binds
    abstract fun bindMapStorage(impl: AndroidMapStorage): MapStorage

    @Binds
    @IntoSet
    abstract fun bindMapNavContribution(impl: MapNavContribution): NavGraphContribution
}
