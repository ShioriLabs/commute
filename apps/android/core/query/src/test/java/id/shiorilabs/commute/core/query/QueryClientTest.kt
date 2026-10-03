package id.shiorilabs.commute.core.query

import id.shiorilabs.commute.core.query.store.StoredEntry
import id.shiorilabs.commute.core.query.testing.FakeNetworkMonitor
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.Fetched
import id.shiorilabs.commute.core.type.UIState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class QueryClientTest {

    @Serializable
    data class Thing(val name: String)

    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-10-03T10:00:00Z")
    private val clock = MutableClock(start)
    private val store = FakeQueryStore()
    private val network = FakeNetworkMonitor()

    private var calls = 0
    private val sentEtags = mutableListOf<String?>()
    private var answer: suspend (etag: String?) -> Fetched<Thing> = { Fetched.Body(Thing("fresh"), "W/\"2\"") }

    private fun spec(vararg key: String = arrayOf("thing", "1"), isUsable: (Thing) -> Boolean = { true }) =
        QuerySpec(queryKey(*key), Thing.serializer(), QueryPolicy.freshFor(Duration.ofMinutes(10)), isUsable) { etag ->
            calls++
            sentEtags += etag
            answer(etag)
        }

    /** Leaves what an earlier launch stored under `thing/1`, confirmed [age] ago. */
    private fun stored(name: String = "stored", age: Duration = Duration.ofMinutes(1), key: String = "thing/1") {
        store.entries[key] = StoredEntry(
            key = key,
            body = Json.encodeToString(Thing.serializer(), Thing(name)),
            etag = "W/\"1\"",
            fetchedAtMillis = (start - age).toEpochMilli(),
        )
    }

    private fun TestScope.client(): QueryClient = QueryClient(store, network, clock, backgroundScope).also { runCurrent() }

    private fun <T> TestScope.collect(flow: Flow<T>): List<T> {
        val emissions = mutableListOf<T>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { flow.toList(emissions) }
        return emissions
    }

    @Test
    fun `with nothing held it loads, fetches and stores`() = runTest {
        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertEquals(Query<Thing>(isFetching = true), emissions.first())
        assertEquals(Query(Thing("fresh"), start, isFetching = false), emissions.last())
        assertEquals(listOf<String?>(null), sentEtags)
        assertEquals("W/\"2\"", store.entries.getValue("thing/1").etag)
    }

    @Test
    fun `a fresh stored answer is served from disk without asking`() = runTest {
        stored(age = Duration.ofMinutes(5))

        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertEquals(listOf(Query(Thing("stored"), start - Duration.ofMinutes(5))), emissions)
        assertEquals(0, calls)
    }

    @Test
    fun `a stale answer shows at once, then is revalidated with its ETag`() = runTest {
        stored(age = Duration.ofMinutes(11))

        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertEquals(Query(Thing("stored"), start - Duration.ofMinutes(11), isFetching = true), emissions.first())
        assertEquals(Query(Thing("fresh"), start), emissions.last())
        assertEquals(listOf<String?>("W/\"1\""), sentEtags)
    }

    @Test
    fun `a 304 confirms the stored answer without rewriting it`() = runTest {
        stored(age = Duration.ofHours(2))
        answer = { Fetched.NotModified("W/\"1\"") }

        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertEquals(Query(Thing("stored"), start), emissions.last())
        assertEquals(0, store.puts)
        assertEquals(start.toEpochMilli(), store.entries.getValue("thing/1").fetchedAtMillis)
    }

    @Test
    fun `observers of one key share one fetch`() = runTest {
        val gate = CompletableDeferred<Unit>()
        answer = {
            gate.await()
            Fetched.Body(Thing("fresh"), null)
        }
        val client = client()

        val first = collect(client.observe(spec()))
        val second = collect(client.observe(spec()))
        runCurrent()
        gate.complete(Unit)
        runCurrent()

        assertEquals(1, calls)
        assertEquals(Thing("fresh"), first.last().data)
        assertEquals(Thing("fresh"), second.last().data)
    }

    @Test
    fun `a failed refresh keeps the answer held, outdated`() = runTest {
        stored(age = Duration.ofHours(2))
        answer = { throw IOException("tunnel") }

        val emissions = collect(client().observe(spec()))
        runCurrent()

        val last = emissions.last()
        assertEquals(Thing("stored"), last.data)
        assertTrue(last.failure is Failure.Network.NoConnection)
        assertTrue(last.isOutdated)
        assertEquals(UIState.Success(Thing("stored")), last.toUIState())
    }

    @Test
    fun `a failure with nothing held is an error`() = runTest {
        answer = { throw IOException("tunnel") }

        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertTrue(emissions.last().toUIState() is UIState.Error)
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `offline it asks nothing, and revalidates on reconnecting`() = runTest {
        stored(age = Duration.ofHours(2))
        network.isOnline.value = false
        val client = client()

        val emissions = collect(client.observe(spec()))
        runCurrent()

        assertEquals(0, calls)
        assertEquals(Thing("stored"), emissions.last().data)
        assertTrue(emissions.last().failure is Failure.Network.NoConnection)

        network.isOnline.value = true
        runCurrent()

        assertEquals(1, calls)
        assertEquals(Query(Thing("fresh"), start), emissions.last())
    }

    @Test
    fun `an unusable answer is shown but asked for again`() = runTest {
        stored(name = "", age = Duration.ofMinutes(1))

        val emissions = collect(client().observe(spec(isUsable = { it.name.isNotEmpty() })))
        runCurrent()

        assertEquals(Thing(""), emissions.first().data)
        assertEquals(1, calls)
        assertEquals(Thing("fresh"), emissions.last().data)
    }

    @Test
    fun `a stored body that no longer decodes is dropped and fetched again`() = runTest {
        store.entries["thing/1"] = StoredEntry("thing/1", """{"unrelated":1}""", "W/\"1\"", start.toEpochMilli())

        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertEquals(listOf<String?>(null), sentEtags)
        assertEquals(Thing("fresh"), emissions.last().data)
    }

    @Test
    fun `a broken disk still serves from the network`() = runTest {
        store.broken = true

        val emissions = collect(client().observe(spec()))
        runCurrent()

        assertEquals(Query(Thing("fresh"), start), emissions.last())
    }

    @Test
    fun `invalidating a prefix refetches the observed keys under it, and only those`() = runTest {
        stored(key = "thing/1")
        stored(key = "other/1")
        val client = client()
        val thing = collect(client.observe(spec("thing", "1")))
        collect(client.observe(spec("other", "1")))
        runCurrent()
        assertEquals(0, calls)

        client.invalidate(queryKey("thing"))
        runCurrent()

        assertEquals(1, calls)
        assertEquals(Thing("fresh"), thing.last().data)
    }

    @Test
    fun `refetch returns once the observed keys under it have answered`() = runTest {
        stored(age = Duration.ofMinutes(1))
        val gate = CompletableDeferred<Unit>()
        answer = {
            gate.await()
            Fetched.NotModified("W/\"1\"")
        }
        val client = client()
        val thing = collect(client.observe(spec()))
        runCurrent()

        val refetch = backgroundScope.async { client.refetch(queryKey("thing")) }
        runCurrent()
        assertTrue(thing.last().isFetching)
        assertFalse(refetch.isCompleted)

        gate.complete(Unit)
        runCurrent()

        assertEquals(Refetched(unchanged = 1), refetch.getCompleted())
        assertEquals(Query(Thing("stored"), start), thing.last())
    }

    @Test
    fun `refetch counts what changed, and a full answer that is the same again as unchanged`() = runTest {
        stored(name = "stored", key = "thing/1")
        stored(name = "stored", key = "thing/2")
        answer = { Fetched.Body(Thing("fresh"), null) }
        val client = client()
        collect(client.observe(spec("thing", "1")))
        // The second key's server answers in full, with what is already held.
        collect(
            client.observe(
                QuerySpec(queryKey("thing", "2"), Thing.serializer(), QueryPolicy.freshFor(Duration.ofMinutes(10))) {
                    Fetched.Body(Thing("stored"), null)
                },
            ),
        )
        runCurrent()

        assertEquals(Refetched(changed = 1, unchanged = 1), client.refetch(queryKey("thing")))
    }

    @Test
    fun `refetch offline returns at once, every observed key failed and its answer outdated`() = runTest {
        stored(age = Duration.ofMinutes(1))
        network.isOnline.value = false
        val client = client()
        val thing = collect(client.observe(spec()))
        runCurrent()

        assertEquals(Refetched(failed = 1), client.refetch(queryKey("thing")))
        assertEquals(0, calls)
        assertTrue(thing.last().isOutdated)
    }

    @Test
    fun `fetch returns a fresh answer without asking`() = runTest {
        stored(age = Duration.ofMinutes(1))

        val result = client().fetch(spec())

        assertEquals(Thing("stored"), result.getOrNull())
        assertEquals(0, calls)
    }

    @Test
    fun `fetch falls back to a stale answer when the network fails`() = runTest {
        stored(age = Duration.ofHours(2))
        answer = { throw IOException("tunnel") }

        val result = client().fetch(spec())

        assertEquals(Thing("stored"), result.getOrNull())
        assertEquals(1, calls)
    }

    @Test
    fun `fetch offline with nothing held is no connection`() = runTest {
        network.isOnline.value = false

        val result = client().fetch(spec())

        assertTrue(result.leftOrNull() is Failure.Network.NoConnection)
        assertEquals(0, calls)
    }

    @Test
    fun `peek sees only what this session has loaded`() = runTest {
        stored()
        val client = client()
        assertNull(client.peek(spec()))

        client.fetch(spec())

        assertEquals(Thing("stored"), client.peek(spec())?.data)
    }

    @Test
    fun `prune drops what has gone unread for a month`() = runTest {
        stored(key = "thing/1")
        stored(key = "other/1")
        store.lastUsed["thing/1"] = (start - Duration.ofDays(31)).toEpochMilli()
        store.lastUsed["other/1"] = (start - Duration.ofDays(2)).toEpochMilli()

        client().prune()

        assertFalse("thing/1" in store.entries)
        assertTrue("other/1" in store.entries)
    }

    @Test
    fun `clear empties the disk`() = runTest {
        stored()
        val client = client()

        client.clear()

        assertEquals(0L, client.size())
    }
}
