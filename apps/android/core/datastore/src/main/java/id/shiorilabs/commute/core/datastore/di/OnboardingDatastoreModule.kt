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
import id.shiorilabs.commute.core.datastore.qualifier.OnboardingDataStore
import javax.inject.Singleton

private val Context.onboardingDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_onboarding")

@Module
@InstallIn(SingletonComponent::class)
object OnboardingDatastoreModule {

    @Provides
    @Singleton
    @OnboardingDataStore
    fun provideOnboardingDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.onboardingDataStore
}
