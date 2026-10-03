package id.shiorilabs.commute.core.query.db

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class QueryEntryDaoTest {

    private lateinit var database: QueryDatabase
    private lateinit var dao: QueryEntryDao

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), QueryDatabase::class.java).build()
        dao = database.entries()
    }

    @After
    fun tearDown() = database.close()

    private fun entry(key: String, usedAt: Long, size: Long = 10, etag: String? = "W/\"1\"") =
        QueryEntryEntity(key, "x".repeat(size.toInt()), etag, fetchedAt = usedAt, lastUsedAt = usedAt, size = size)

    @Test
    fun upsertReplacesAndConfirmKeepsTheBody() = runTest {
        dao.upsert(entry("a", usedAt = 1))
        dao.upsert(entry("a", usedAt = 2, etag = "W/\"2\""))

        dao.confirm("a", fetchedAt = 5, etag = null)

        val stored = dao.get("a")!!
        assertEquals(5L, stored.fetchedAt)
        assertEquals(5L, stored.lastUsedAt)
        assertEquals("W/\"2\"", stored.etag)
    }

    @Test
    fun pruneDropsTheUnusedThenTheLeastRecentlyUsedOverTheCap() = runTest {
        dao.upsert(entry("ancient", usedAt = 1))
        dao.upsert(entry("old", usedAt = 10))
        dao.upsert(entry("recent", usedAt = 20))
        dao.upsert(entry("newest", usedAt = 30))

        dao.prune(unusedBefore = 5, maxSize = 20)

        assertNull(dao.get("ancient"))
        assertNull(dao.get("old"))
        assertEquals(20L, dao.totalSize())
    }

    @Test
    fun clearEmptiesTheTable() = runTest {
        dao.upsert(entry("a", usedAt = 1))

        dao.clear()

        assertEquals(0L, dao.totalSize())
    }
}
