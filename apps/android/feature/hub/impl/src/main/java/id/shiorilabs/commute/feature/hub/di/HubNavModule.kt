package id.shiorilabs.commute.feature.hub.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.hub.navigation.HubNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class HubNavModule {

    @Binds
    @IntoSet
    abstract fun bindHubNavContribution(impl: HubNavContribution): NavGraphContribution
}
