package id.shiorilabs.commute.feature.card.di

import android.content.Context
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import dagger.multibindings.Multibinds
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.feature.card.api.CardFareCheck
import id.shiorilabs.commute.feature.card.api.CardTap
import id.shiorilabs.commute.feature.card.dump.CardDumpStore
import id.shiorilabs.commute.feature.card.dump.CardDumps
import id.shiorilabs.commute.feature.card.iso.IsoProbe
import id.shiorilabs.commute.feature.card.navigation.CardNavContribution
import id.shiorilabs.commute.feature.card.presentation.CardFareCheckImpl
import id.shiorilabs.commute.feature.card.presentation.CardTapImpl
import id.shiorilabs.commute.feature.card.reader.CARD_STATION_NAMES_ASSET
import id.shiorilabs.commute.feature.card.reader.CardReader
import id.shiorilabs.commute.feature.card.reader.CardStationNames
import id.shiorilabs.commute.feature.card.reader.JAPAN_IC_LINES_ASSET
import id.shiorilabs.commute.feature.card.reader.JapanIcLines
import id.shiorilabs.commute.feature.card.reader.JapanIcReader
import id.shiorilabs.commute.feature.card.reader.KmtReader
import id.shiorilabs.commute.feature.station.data.StationDirectory
import javax.inject.Singleton

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

    /** What the trip page renders to hold a card against its fare. */
    @Binds
    internal abstract fun bindCardFareCheck(impl: CardFareCheckImpl): CardFareCheck

    /** Empty unless the private submodule adds a probe. */
    @Multibinds
    internal abstract fun isoProbes(): Set<IsoProbe>

    companion object {
        /** One reader per card type; a new card adds its own `@IntoSet` here. */
        @Provides
        @IntoSet
        internal fun provideKmtReader(): CardReader = KmtReader()

        @Provides
        @IntoSet
        internal fun provideJapanIcReader(@ApplicationContext context: Context): CardReader {
            val lines = JapanIcLines { context.assets.open(JAPAN_IC_LINES_ASSET) }
            return JapanIcReader(lines = lines::get)
        }

        /** One for the app, so the snapshot is read once. */
        @Provides
        @Singleton
        internal fun provideCardStationNames(directory: StationDirectory, @ApplicationContext context: Context): CardStationNames =
            CardStationNames(directory) { context.assets.open(CARD_STATION_NAMES_ASSET) }
    }
}
