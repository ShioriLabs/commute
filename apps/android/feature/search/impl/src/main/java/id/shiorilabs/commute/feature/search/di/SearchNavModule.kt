package id.shiorilabs.commute.feature.search.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.search.navigation.SearchNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class SearchNavModule {

    @Binds
    @IntoSet
    abstract fun bindSearchNavContribution(impl: SearchNavContribution): NavGraphContribution
}
