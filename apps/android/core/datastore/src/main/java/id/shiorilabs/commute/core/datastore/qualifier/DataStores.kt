package id.shiorilabs.commute.core.datastore.qualifier

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import javax.inject.Qualifier

/**
 * Hilt [Qualifier] for the preferences [DataStore]<[Preferences]> backing the rider's saved
 * stations shown on the home screen.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class SavedStationsDataStore
