package id.shiorilabs.commute.feature.line.data

import id.shiorilabs.commute.core.network.testing.FakeCommuteService
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.testing.FakeNetworkMonitor
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import id.shiorilabs.commute.feature.line.data.impl.LineDetailRepositoryImpl
import id.shiorilabs.commute.feature.line.domain.LineStop
import id.shiorilabs.commute.feature.line.domain.SegmentKind
import id.shiorilabs.commute.feature.line.lineFixture
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class LineDetailRepositoryImplTest {

    private val store = FakeQueryStore()

    /** A cache over [store]; a second one is a later launch, reading back what the first wrote. */
    private fun TestScope.queries() = QueryClient(
        store = store,
        networkMonitor = FakeNetworkMonitor(),
        clock = Clock.fixed(Instant.parse("2026-10-03T10:00:00Z"), ZoneOffset.UTC),
        scope = backgroundScope,
    )

    @Test
    fun `a line carries its operator, colour and segments in the API's order`() = runTest {
        val service = FakeCommuteService().apply { line = { _, _ -> lineFixture("line_bogor.json") } }

        val line = LineDetailRepositoryImpl(service, queries()).line("KCI", "B").getOrNull()!!

        assertEquals("KCI", line.operator)
        assertEquals("Commuter Line", line.operatorName)
        assertEquals("Lin Bogor", line.name)
        assertEquals("#EE3D43", line.colorCode)
        assertEquals(listOf(SegmentKind.TRUNK, SegmentKind.CONTINUATION, SegmentKind.RAMP), line.segments.map { it.kind })
        assertEquals("CTA", line.segments[2].joinsAtCode)
        assertEquals(
            LineStop("KCI-JAKK", "JAKK", "Jakarta Kota", "B01", true, listOf("KCI:C", "KCI:TP")),
            line.segments.first().stations.first(),
        )
    }

    @Test
    fun `the operator and code are sent as given, and the line is held for the session`() = runTest {
        var asked: Pair<String, String>? = null
        val service = FakeCommuteService().apply {
            line = { operator, lineCode ->
                asked = operator to lineCode
                lineFixture("line_bogor.json")
            }
        }
        val repository = LineDetailRepositoryImpl(service, queries())

        repository.line("KCI", "B")
        repository.line("KCI", "B")

        assertEquals("KCI" to "B", asked)
        assertEquals(1, service.lineCalls)
        assertEquals("Lin Bogor", repository.cachedLine("KCI", "B")?.name)
    }

    @Test
    fun `a line survives a trip through the disk`() = runTest {
        val service = FakeCommuteService().apply { line = { _, _ -> lineFixture("line_cikarang.json") } }
        LineDetailRepositoryImpl(service, queries()).line("KCI", "C")

        // Offline at the next launch: a fresh cache, so the line comes back off the disk.
        val stored = LineDetailRepositoryImpl(FakeCommuteService(), queries()).line("KCI", "C").getOrNull()

        assertEquals(listOf(SegmentKind.TRUNK, SegmentKind.LOOP), stored?.segments?.map { it.kind })
    }
}
