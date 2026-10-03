package id.shiorilabs.commute.core.query.di

import javax.inject.Qualifier

/**
 * Hilt [Qualifier] for the [kotlinx.coroutines.CoroutineScope] that lives as long as the app: work
 * started there (a query's fetch) outlives the screen that asked for it.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class ApplicationScope
