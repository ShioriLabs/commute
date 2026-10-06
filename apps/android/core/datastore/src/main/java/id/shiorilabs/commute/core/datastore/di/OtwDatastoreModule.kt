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
import id.shiorilabs.commute.core.datastore.qualifier.OtwDataStore
import javax.inject.Singleton

private val Context.otwDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_otw")

@Module
@InstallIn(SingletonComponent::class)
object OtwDatastoreModule {

    @Provides
    @Singleton
    @OtwDataStore
    fun provideOtwDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.otwDataStore
}
