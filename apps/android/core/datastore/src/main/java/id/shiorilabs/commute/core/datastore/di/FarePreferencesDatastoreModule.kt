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
import id.shiorilabs.commute.core.datastore.qualifier.FarePreferencesDataStore
import javax.inject.Singleton

private val Context.farePreferencesDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_fare_preferences")

@Module
@InstallIn(SingletonComponent::class)
object FarePreferencesDatastoreModule {

    @Provides
    @Singleton
    @FarePreferencesDataStore
    fun provideFarePreferencesDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.farePreferencesDataStore
}
