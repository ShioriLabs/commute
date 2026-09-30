package id.shiorilabs.commute.feature.saved.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.saved.navigation.SavedNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class SavedNavModule {

    @Binds
    @IntoSet
    abstract fun bindSavedNavContribution(impl: SavedNavContribution): NavGraphContribution
}
