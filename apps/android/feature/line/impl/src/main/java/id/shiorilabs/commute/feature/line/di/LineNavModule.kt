package id.shiorilabs.commute.feature.line.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.line.navigation.LineNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class LineNavModule {

    @Binds
    @IntoSet
    abstract fun bindLineNavContribution(impl: LineNavContribution): NavGraphContribution
}
