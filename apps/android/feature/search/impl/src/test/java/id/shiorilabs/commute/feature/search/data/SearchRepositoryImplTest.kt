package id.shiorilabs.commute.feature.search.data

import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.query.testing.FakeNetworkMonitor
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import id.shiorilabs.commute.core.query.testing.testQueryClient
import id.shiorilabs.commute.core.type.ApiException
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.search.data.impl.SearchRepositoryImpl
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class SearchRepositoryImplTest {

    private val empty = SearchableIndex(lines = emptyMap(), items = emptyList())

    @Test
    fun `fetches the index once and serves it from memory after`() = runTest {
        val service = FakeCommuteService().apply { searchables = { empty } }
        val repository = SearchRepositoryImpl(service, testQueryClient(backgroundScope))

        repository.searchables()
        repository.searchables()

        assertEquals(1, service.searchablesCalls)
    }

    @Test
    fun `a failure is not cached`() = runTest {
        var fail = true
        val service = FakeCommuteService().apply {
            searchables = { if (fail) throw IOException("offline") else empty }
        }
        val repository = SearchRepositoryImpl(service, testQueryClient(backgroundScope))

        val first = repository.searchables()
        fail = false
        val second = repository.searchables()

        assertTrue(first.leftOrNull() is Failure.Network.NoConnection)
        assertTrue(second.isRight())
        assertEquals(2, service.searchablesCalls)
    }

    @Test
    fun `a non-2xx maps to Remote with its status`() = runTest {
        val service = FakeCommuteService().apply { searchables = { throw ApiException(503) } }

        val failure = SearchRepositoryImpl(service, testQueryClient(backgroundScope)).searchables().leftOrNull()

        assertEquals(503, (failure as Failure.Remote).code)
    }

    @Test
    fun `an index an earlier launch fetched serves search offline, however old`() = runTest {
        val store = FakeQueryStore()
        val online = FakeCommuteService().apply { searchables = { empty } }
        SearchRepositoryImpl(online, testQueryClient(backgroundScope, store = store)).searchables()

        val dayLater = Clock.fixed(Instant.parse("2026-10-04T10:00:00Z"), ZoneOffset.UTC)
        val offline = testQueryClient(backgroundScope, dayLater, store, FakeNetworkMonitor(online = false))
        val answer = SearchRepositoryImpl(FakeCommuteService(), offline).searchables()

        assertEquals(emptyList<Any>(), answer.getOrNull())
    }
}
