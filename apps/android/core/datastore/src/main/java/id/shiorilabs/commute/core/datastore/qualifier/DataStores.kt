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
