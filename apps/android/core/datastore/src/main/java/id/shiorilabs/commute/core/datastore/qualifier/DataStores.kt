package id.shiorilabs.commute.core.datastore.qualifier

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import javax.inject.Qualifier

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing what the rider pinned to
 * the home screen: stations and Dari→Ke pairs.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class SavedDataStore

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing the places the rider last
 * opened from search.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class RecentSearchesDataStore

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing the OTW search's standing
 * settings and its recently picked stations.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class FarePreferencesDataStore

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing which half of search the
 * rider was last in.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class SearchModeDataStore

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing home's own settings: for
 * now, whether the rider waved off the "near you" prompt.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class HomeDataStore

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing what the rider lets the
 * app use their location for (Pengaturan → Lokasi).
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class LocationDataStore
