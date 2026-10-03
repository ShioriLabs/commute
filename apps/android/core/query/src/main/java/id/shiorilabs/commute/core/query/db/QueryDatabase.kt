package id.shiorilabs.commute.core.query.db

import androidx.room.Database
import androidx.room.RoomDatabase

/** The response cache: one key-value table. Losing it costs a refetch, never user data. */
@Database(entities = [QueryEntryEntity::class], version = 1)
internal abstract class QueryDatabase : RoomDatabase() {

    abstract fun entries(): QueryEntryDao

    companion object {

        const val NAME = "commute_query.db"
    }
}
