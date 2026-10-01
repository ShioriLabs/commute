package id.shiorilabs.commute.core.datastore.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.datastore.qualifier.RecentSearchesDataStore
import javax.inject.Singleton

private val Context.recentSearchesDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_recent_searches")

@Module
@InstallIn(SingletonComponent::class)
object RecentSearchesDatastoreModule {

    @Provides
    @Singleton
    @RecentSearchesDataStore
    fun provideRecentSearchesDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.recentSearchesDataStore
}
