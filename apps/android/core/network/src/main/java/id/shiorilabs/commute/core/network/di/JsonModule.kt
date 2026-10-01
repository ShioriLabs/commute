package id.shiorilabs.commute.core.network.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object JsonModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        // The API only ever adds fields, and an installed app must keep decoding after it does.
        ignoreUnknownKeys = true
    }
}
