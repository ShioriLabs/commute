package id.shiorilabs.commute.core.query.di

import android.content.Context
import androidx.room.Room
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.connectivity.NetworkMonitor
import id.shiorilabs.commute.core.query.connectivity.AndroidNetworkMonitor
import id.shiorilabs.commute.core.query.db.QueryDatabase
import id.shiorilabs.commute.core.query.db.QueryEntryDao
import id.shiorilabs.commute.core.query.store.QueryStore
import id.shiorilabs.commute.core.query.store.RoomQueryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
internal abstract class QueryModule {

    @Binds
    abstract fun bindQueryStore(impl: RoomQueryStore): QueryStore

    @Binds
    @Singleton
    abstract fun bindNetworkMonitor(impl: AndroidNetworkMonitor): NetworkMonitor

    companion object {

        @Provides
        @Singleton
        fun provideDatabase(@ApplicationContext context: Context): QueryDatabase =
            Room.databaseBuilder(context, QueryDatabase::class.java, QueryDatabase.NAME)
                // A cache: a schema change costs a refetch, never anything the rider made.
                .fallbackToDestructiveMigration(dropAllTables = true)
                .build()

        @Provides
        fun provideDao(database: QueryDatabase): QueryEntryDao = database.entries()

        @Provides
        @Singleton
        @ApplicationScope
        fun provideApplicationScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
