package id.shiorilabs.commute.feature.journey.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.journey.navigation.JourneyNavContribution
import id.shiorilabs.commute.feature.journey.presentation.OtwPanel
import id.shiorilabs.commute.feature.journey.presentation.OtwPanelImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class JourneyNavModule {

    @Binds
    @IntoSet
    abstract fun bindJourneyNavContribution(impl: JourneyNavContribution): NavGraphContribution

    /** What search's OTW tab renders. */
    @Binds
    abstract fun bindOtwPanel(impl: OtwPanelImpl): OtwPanel
}
