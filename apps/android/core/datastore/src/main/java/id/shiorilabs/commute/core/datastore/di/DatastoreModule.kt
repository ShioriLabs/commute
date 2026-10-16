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
import id.shiorilabs.commute.core.datastore.qualifier.AppearanceDataStore
import id.shiorilabs.commute.core.datastore.qualifier.DeveloperDataStore
import id.shiorilabs.commute.core.datastore.qualifier.FarePreferencesDataStore
import id.shiorilabs.commute.core.datastore.qualifier.HomeDataStore
import id.shiorilabs.commute.core.datastore.qualifier.LocationDataStore
import id.shiorilabs.commute.core.datastore.qualifier.OnboardingDataStore
import id.shiorilabs.commute.core.datastore.qualifier.OtwDataStore
import id.shiorilabs.commute.core.datastore.qualifier.RecentSearchesDataStore
import id.shiorilabs.commute.core.datastore.qualifier.SavedDataStore
import id.shiorilabs.commute.core.datastore.qualifier.SearchModeDataStore
import javax.inject.Singleton

// One file per store on disk, each under its own name.
private val Context.appearanceDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_appearance")
private val Context.developerDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_developer")
private val Context.farePreferencesDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_fare_preferences")
private val Context.homeDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_home")
private val Context.locationDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_location")
private val Context.onboardingDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_onboarding")
private val Context.otwDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_otw")
private val Context.recentSearchesDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_recent_searches")
private val Context.savedDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_saved")
private val Context.searchModeDataStore: DataStore<Preferences> by preferencesDataStore(name = "commute_search_mode")

@Module
@InstallIn(SingletonComponent::class)
object DatastoreModule {

    @Provides
    @Singleton
    @AppearanceDataStore
    fun provideAppearanceDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.appearanceDataStore

    @Provides
    @Singleton
    @DeveloperDataStore
    fun provideDeveloperDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.developerDataStore

    @Provides
    @Singleton
    @FarePreferencesDataStore
    fun provideFarePreferencesDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.farePreferencesDataStore

    @Provides
    @Singleton
    @HomeDataStore
    fun provideHomeDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.homeDataStore

    @Provides
    @Singleton
    @LocationDataStore
    fun provideLocationDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.locationDataStore

    @Provides
    @Singleton
    @OnboardingDataStore
    fun provideOnboardingDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.onboardingDataStore

    @Provides
    @Singleton
    @OtwDataStore
    fun provideOtwDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.otwDataStore

    @Provides
    @Singleton
    @RecentSearchesDataStore
    fun provideRecentSearchesDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.recentSearchesDataStore

    @Provides
    @Singleton
    @SavedDataStore
    fun provideSavedDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.savedDataStore

    @Provides
    @Singleton
    @SearchModeDataStore
    fun provideSearchModeDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.searchModeDataStore
}
