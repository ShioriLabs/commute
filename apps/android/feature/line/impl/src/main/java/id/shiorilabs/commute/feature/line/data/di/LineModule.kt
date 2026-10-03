package id.shiorilabs.commute.feature.line.data.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.feature.line.data.LineDetailRepository
import id.shiorilabs.commute.feature.line.data.impl.LineDetailRepositoryImpl

@Module
@InstallIn(SingletonComponent::class)
abstract class LineModule {

    @Binds
    abstract fun bindLineDetailRepository(impl: LineDetailRepositoryImpl): LineDetailRepository
}
