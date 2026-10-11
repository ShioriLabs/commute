package id.shiorilabs.commute.feature.onboarding.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.onboarding.navigation.OnboardingNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class OnboardingNavModule {

    @Binds
    @IntoSet
    abstract fun bindOnboardingNavContribution(impl: OnboardingNavContribution): NavGraphContribution
}
