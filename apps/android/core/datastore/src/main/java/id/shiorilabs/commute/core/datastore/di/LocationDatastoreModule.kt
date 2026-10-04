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
import id.shiorilabs.commute.core.datastore.qualifier.LocationDataStore
import javax.inject.Singleton

private val Context.locationDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_location")

@Module
@InstallIn(SingletonComponent::class)
object LocationDatastoreModule {

    @Provides
    @Singleton
    @LocationDataStore
    fun provideLocationDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.locationDataStore
}
