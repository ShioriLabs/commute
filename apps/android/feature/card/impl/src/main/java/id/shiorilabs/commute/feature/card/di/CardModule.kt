package id.shiorilabs.commute.feature.card.di

import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.card.api.CardTap
import id.shiorilabs.commute.feature.card.dump.CardDumpStore
import id.shiorilabs.commute.feature.card.dump.CardDumps
import id.shiorilabs.commute.feature.card.navigation.CardNavContribution
import id.shiorilabs.commute.feature.card.presentation.CardTapImpl
import id.shiorilabs.commute.feature.card.reader.CardReader
import id.shiorilabs.commute.feature.card.reader.KmtReader

@Module
@InstallIn(SingletonComponent::class)
abstract class CardModule {

    @Binds
    abstract fun bindCardDumps(impl: CardDumpStore): CardDumps

    @Binds
    @IntoSet
    abstract fun bindCardNavContribution(impl: CardNavContribution): NavGraphContribution

    /** What home renders for a card touched to the phone. */
    @Binds
    internal abstract fun bindCardTap(impl: CardTapImpl): CardTap

    companion object {
        /** One reader per card type; a new card adds its own `@IntoSet` here. */
        @Provides
        @IntoSet
        internal fun provideKmtReader(): CardReader = KmtReader()
    }
}
