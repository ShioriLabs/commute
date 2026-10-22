package id.shiorilabs.commute.feature.card.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.card.dump.CardDumpStore
import id.shiorilabs.commute.feature.card.dump.CardDumps
import id.shiorilabs.commute.feature.card.navigation.CardNavContribution

@Module
@InstallIn(SingletonComponent::class)
abstract class CardModule {

    @Binds
    abstract fun bindCardDumps(impl: CardDumpStore): CardDumps

    @Binds
    @IntoSet
    abstract fun bindCardNavContribution(impl: CardNavContribution): NavGraphContribution
}
