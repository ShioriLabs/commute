package id.shiorilabs.commute.feature.station.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.station.navigation.StationNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class StationNavModule {

    @Binds
    @IntoSet
    abstract fun bindStationNavContribution(impl: StationNavContribution): NavGraphContribution
}
