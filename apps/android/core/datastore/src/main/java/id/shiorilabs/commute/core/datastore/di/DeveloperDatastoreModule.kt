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
import id.shiorilabs.commute.core.datastore.qualifier.DeveloperDataStore
import javax.inject.Singleton

private val Context.developerDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_developer")

@Module
@InstallIn(SingletonComponent::class)
object DeveloperDatastoreModule {

    @Provides
    @Singleton
    @DeveloperDataStore
    fun provideDeveloperDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.developerDataStore
}
