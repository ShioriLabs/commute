package id.shiorilabs.commute.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import id.shiorilabs.commute.core.time.JAKARTA
import java.time.Clock
import javax.inject.Singleton

/**
 * The clock timetables are read against: Jakarta's, whatever zone the phone is set to, since every
 * departure time is written in it. Injected so a test can stand still at a chosen minute.
 */
@Module
@InstallIn(SingletonComponent::class)
object ClockModule {

    @Provides
    @Singleton
    fun provideClock(): Clock = Clock.system(JAKARTA)
}
