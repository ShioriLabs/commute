package id.shiorilabs.commute.feature.line.presentation

import androidx.lifecycle.SavedStateHandle
import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.line.data.LineDetailRepository
import id.shiorilabs.commute.feature.line.data.impl.toLineDetail
import id.shiorilabs.commute.feature.line.domain.LineDetail
import id.shiorilabs.commute.feature.line.domain.StripRow
import id.shiorilabs.commute.feature.line.lineFixture
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
class LineViewModelTest {

    private val bogor = lineFixture("line_bogor.json").toLineDetail()

    private inner class FakeLineDetailRepository : LineDetailRepository {
        var result: Either<Failure, LineDetail> = bogor.right()
        var cached: LineDetail? = null
        val asked = mutableListOf<Pair<String, String>>()

        override suspend fun line(operator: String, lineCode: String): Either<Failure, LineDetail> {
            asked += operator to lineCode
            return result
        }

        override fun cachedLine(operator: String, lineCode: String): LineDetail? = cached
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> =
            mapOf("KCI:C" to LineInfo("Lin Cikarang", "C", "#25B8EB", "KCI")).right()
    }

    private val details = FakeLineDetailRepository()

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(savedState: SavedStateHandle = SavedStateHandle()) =
        LineViewModel("KCI", "B", savedState, details, FakeLineRepository())

    private val LineUiState.lastStop get() = strip!!.rows.filterIsInstance<StripRow.Stop>().last().station.code

    @Test
    fun `the page loads the line, its strip and the line dictionary`() = runTest {
        val page = viewModel().state.first { it.strip != null && it.lines.isNotEmpty() }

        assertEquals("Lin Bogor", (page.line as UIState.Success).data.name)
        assertEquals("BOO", page.lastStop)
        assertEquals("Lin Cikarang", page.lines.getValue("KCI:C").name)
        assertEquals(listOf("KCI" to "B"), details.asked)
    }

    @Test
    fun `a ramp's pill shows its branch, and the choice survives the process`() = runTest {
        val savedState = SavedStateHandle()
        viewModel(savedState).onShowBranch(1)

        // The process died and came back: a new view model over the saved state.
        val page = viewModel(savedState).state.first { it.strip != null }

        assertEquals("NMO", page.lastStop)
    }

    @Test
    fun `a line that fails is an error with no strip, and retry asks again`() = runTest {
        details.result = Failure.Remote(404).left()
        val vm = viewModel()

        val failed = vm.state.first { it.line !is UIState.Loading }
        assertTrue(failed.line is UIState.Error)
        assertEquals(null, failed.strip)

        details.result = bogor.right()
        vm.retry()

        assertEquals("BOO", vm.state.first { it.strip != null }.lastStop)
        assertEquals(2, details.asked.size)
    }

    @Test
    fun `a line already in memory is drawn on the first frame`() = runTest {
        details.cached = bogor

        val first = viewModel().state.value

        assertEquals("BOO", first.lastStop)
    }
}
