package id.shiorilabs.commute.feature.hub.data

import id.shiorilabs.commute.core.model.models.Hub as HubDto
import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.testing.FakeNetworkMonitor
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import id.shiorilabs.commute.feature.hub.data.impl.HubRepositoryImpl
import id.shiorilabs.commute.feature.hub.domain.HubKind
import id.shiorilabs.commute.feature.hub.domain.HubMember
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/** Against `/hubs/dukuh-atas` as the live API sends it, decoded the way the app decodes it. */
class HubRepositoryImplTest {

    // The app's own configuration (JsonModule): unknown keys are ignored.
    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(): HubDto {
        val body = checkNotNull(javaClass.getResource("/hub.json")).readText()
        return json.decodeFromJsonElement(json.parseToJsonElement(body).jsonObject.getValue("data"))
    }

    private val store = FakeQueryStore()

    /** A cache over [store]; a second one is a later launch, reading back what the first wrote. */
    private fun TestScope.queries(at: String = "2026-10-03T10:00:00Z") = QueryClient(
        store = store,
        networkMonitor = FakeNetworkMonitor(),
        clock = Clock.fixed(Instant.parse(at), ZoneOffset.UTC),
        scope = backgroundScope,
    )

    @Test
    fun `a hub keeps its members in the API's order, with their lines`() = runTest {
        val service = FakeCommuteService().apply { hub = { fixture() } }

        val hub = HubRepositoryImpl(service, queries()).hub("dukuh-atas").getOrNull()!!

        assertEquals("Dukuh Atas", hub.name)
        assertEquals(HubKind.HUB, hub.kind)
        assertEquals(
            listOf("KCI-SUD", "KCI-SUDB", "MRTJ-DKA", "LRTJBDB-DKA", "TJ-H00047P", "TJ-B07663P", "TJ-H00283P"),
            hub.members.map { it.id },
        )
        assertEquals(HubMember("KCI-SUDB", "BNI City", "KCI", listOf("KCI:A", "KCI:C")), hub.members[1])
    }

    @Test
    fun `a kind the app doesn't know reads as an integrated station`() = runTest {
        val service = FakeCommuteService().apply {
            hub = { fixture().copy(kind = "complex") }
        }

        val hub = HubRepositoryImpl(service, queries()).hub("dukuh-atas").getOrNull()!!

        assertEquals(HubKind.INTEGRATED, hub.kind)
    }

    @Test
    fun `the slug is sent as given, and the hub is held for the session`() = runTest {
        var asked: String? = null
        val service = FakeCommuteService().apply {
            hub = { slug ->
                asked = slug
                fixture()
            }
        }
        val repository = HubRepositoryImpl(service, queries())
        assertNull(repository.cachedHub("dukuh-atas"))

        repository.hub("dukuh-atas")
        repository.hub("dukuh-atas")

        assertEquals("dukuh-atas", asked)
        assertEquals(1, service.hubCalls)
        assertEquals("Dukuh Atas", repository.cachedHub("dukuh-atas")?.name)
    }

    @Test
    fun `a hub survives a trip through the disk, and is revalidated with its ETag`() = runTest {
        val service = FakeCommuteService().apply {
            etag = "W/\"1\""
            hub = { fixture() }
        }
        HubRepositoryImpl(service, queries()).hub("dukuh-atas")

        // Offline at the next launch: a fresh cache, so the hub comes back off the disk.
        val offline = HubRepositoryImpl(FakeCommuteService(), queries()).hub("dukuh-atas").getOrNull()
        assertEquals("Dukuh Atas", offline?.name)

        // Hours later, the deploy hasn't changed it: a 304.
        val revalidated = HubRepositoryImpl(service, queries(at = "2026-10-03T12:00:00Z"))
            .observeHub("dukuh-atas")
            .first { it.updatedAt == Instant.parse("2026-10-03T12:00:00Z") }

        assertEquals("Dukuh Atas", revalidated.data?.name)
        assertEquals("W/\"1\"", service.lastIfNoneMatch)
        assertEquals(2, service.hubCalls)
    }
}
