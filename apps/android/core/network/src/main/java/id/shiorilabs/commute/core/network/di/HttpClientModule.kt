package id.shiorilabs.commute.core.network.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.network.HttpClientFactory
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import kotlinx.serialization.json.Json
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object HttpClientModule {

    @Provides
    @Singleton
    fun provideHttpClient(
        json: Json,
        engine: HttpClientEngine,
        environment: Environment,
    ): HttpClient = HttpClientFactory.create(
        json = json,
        engine = engine,
        environment = environment,
    )
}
