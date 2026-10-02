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
import id.shiorilabs.commute.core.datastore.qualifier.SearchModeDataStore
import javax.inject.Singleton

private val Context.searchModeDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_search_mode")

@Module
@InstallIn(SingletonComponent::class)
object SearchModeDatastoreModule {

    @Provides
    @Singleton
    @SearchModeDataStore
    fun provideSearchModeDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.searchModeDataStore
}
