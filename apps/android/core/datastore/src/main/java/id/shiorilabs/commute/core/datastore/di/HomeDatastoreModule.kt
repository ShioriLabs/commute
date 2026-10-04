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
import id.shiorilabs.commute.core.datastore.qualifier.HomeDataStore
import javax.inject.Singleton

private val Context.homeDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_home")

@Module
@InstallIn(SingletonComponent::class)
object HomeDatastoreModule {

    @Provides
    @Singleton
    @HomeDataStore
    fun provideHomeDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.homeDataStore
}
