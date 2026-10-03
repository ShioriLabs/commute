package id.shiorilabs.commute.feature.hub.presentation

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.hub.data.HubRepository
import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.hub.domain.HubKind
import id.shiorilabs.commute.feature.hub.domain.HubMember
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HubViewModelTest {

    private val dukuhAtas = Hub(
        slug = "dukuh-atas",
        name = "Dukuh Atas",
        kind = HubKind.HUB,
        members = listOf(HubMember("KCI-SUD", "Sudirman", "KCI", listOf("KCI:C"))),
    )

    private inner class FakeHubRepository : HubRepository {
        var result: Either<Failure, Hub> = dukuhAtas.right()
        var cached: Hub? = null
        val asked = mutableListOf<String>()

        override suspend fun hub(slug: String): Either<Failure, Hub> {
            asked += slug
            return result
        }

        override fun cachedHub(slug: String): Hub? = cached
    }

    private class FakeLineRepository : LineRepository {
        var calls = 0

        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> {
            calls++
            return mapOf("KCI:C" to LineInfo("Lin Cikarang", "C", "#25B8EB", "KCI")).right()
        }
    }

    private val hubs = FakeHubRepository()
    private val lines = FakeLineRepository()

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = HubViewModel("dukuh-atas", hubs, lines)

    @Test
    fun `the page loads the hub and the line dictionary`() = runTest {
        val page = viewModel().state.first { it.hub is UIState.Success && it.lines.isNotEmpty() }

        assertEquals(dukuhAtas, (page.hub as UIState.Success).data)
        assertEquals("Lin Cikarang", page.lines.getValue("KCI:C").name)
        assertEquals(listOf("dukuh-atas"), hubs.asked)
    }

    @Test
    fun `a hub that fails is an error, and retry asks again`() = runTest {
        hubs.result = Failure.Network.NoConnection().left()
        val vm = viewModel()

        assertTrue(vm.state.first { it.hub !is UIState.Loading }.hub is UIState.Error)

        hubs.result = dukuhAtas.right()
        vm.retry()

        assertEquals(dukuhAtas, (vm.state.first { it.hub is UIState.Success }.hub as UIState.Success).data)
        assertEquals(2, hubs.asked.size)
    }

    @Test
    fun `a hub already in memory is there on the first frame`() = runTest {
        hubs.cached = dukuhAtas

        val first = viewModel().state.value

        assertEquals(dukuhAtas, (first.hub as UIState.Success).data)
    }
}
