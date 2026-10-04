package id.shiorilabs.commute.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.BuildConfig
import id.shiorilabs.commute.core.config.Environment
import javax.inject.Singleton

/**
 * Resolves the [Environment] from `:app`'s generated `BuildConfig` and exposes it to Hilt.
 *
 * `BuildConfig` only exists in `:app`, so this bridge lives here — every other module receives
 * [Environment] by injection and stays `BuildConfig`-free.
 */
@Module
@InstallIn(SingletonComponent::class)
object ConfigModule {

    @Provides
    @Singleton
    fun provideEnvironment(): Environment = Environment(
        apiBaseUrl = BuildConfig.API_BASE_URL,
        appVersion = BuildConfig.VERSION_NAME,
        debug = BuildConfig.DEBUG,
    )
}
