package id.shiorilabs.commute.feature.search.data.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.search.data.impl.SearchRepositoryImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class SearchModule {

    @Binds
    abstract fun bindSearchRepository(impl: SearchRepositoryImpl): SearchRepository
}
