package id.shiorilabs.commute.feature.settings.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.settings.navigation.SettingsNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class SettingsNavModule {

    @Binds
    @IntoSet
    abstract fun bindSettingsNavContribution(impl: SettingsNavContribution): NavGraphContribution
}
