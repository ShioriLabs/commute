package id.shiorilabs.commute.feature.card.presentation

import android.content.Intent
import id.shiorilabs.commute.feature.card.dump.CardDump
import id.shiorilabs.commute.feature.card.dump.CardDumps
import id.shiorilabs.commute.feature.card.felica.FakeCard
import id.shiorilabs.commute.feature.card.felica.IDM
import id.shiorilabs.commute.feature.card.felica.PMM
import id.shiorilabs.commute.feature.card.felica.TappedCard
import id.shiorilabs.commute.feature.card.felica.blocks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CardDumperViewModelTest {
    private class FakeDumps : CardDumps {
        val saved = mutableListOf<Pair<CardDump, String>>()

        override suspend fun save(dump: CardDump, note: String): String {
            saved += dump to note
            return "card-${saved.size}.json"
        }

        override suspend fun count() = saved.size

        override suspend fun share(): Intent? = null

        override suspend fun clear() = saved.clear()
    }

    private val dumps = FakeDumps()

    private fun card() = TappedCard(
        idm = IDM,
        pmm = PMM,
        systemCode = 0x0003,
        transport = FakeCard(listOf(FakeCard.System(code = 0x0003, idm = IDM, services = mapOf(0x090F to FakeCard.Service(blocks = blocks(2)))))),
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `it waits for a card until one is read`() {
        val viewModel = CardDumperViewModel(dumps)
        assertEquals(CardDumperUiState.Phase.Waiting, viewModel.state.value.phase)

        viewModel.read(card())

        val state = viewModel.state.value
        assertEquals(CardDumperUiState.Phase.Done, state.phase)
        assertEquals(2, state.dump!!.systems.single().services.single().blocks.size)
        assertNull(state.progress)
    }

    @Test
    fun `saving keeps the dump with the note and counts it`() {
        val viewModel = CardDumperViewModel(dumps)
        viewModel.read(card())

        viewModel.save("  sebelum tap-in  ")

        assertEquals("  sebelum tap-in  ", dumps.saved.single().second)
        assertEquals("card-1.json", viewModel.state.value.savedAs)
        assertEquals(1, viewModel.state.value.savedCount)
    }

    @Test
    fun `a dump is saved once, however often save is tapped`() {
        val viewModel = CardDumperViewModel(dumps)
        viewModel.read(card())

        viewModel.save("")
        viewModel.save("")

        assertEquals(1, dumps.saved.size)
    }

    @Test
    fun `another tap starts over, and clearing empties the count`() {
        val viewModel = CardDumperViewModel(dumps)
        viewModel.read(card())
        viewModel.save("")

        viewModel.again()
        assertEquals(CardDumperUiState.Phase.Waiting, viewModel.state.value.phase)
        assertNull(viewModel.state.value.dump)

        viewModel.clear()
        assertEquals(0, viewModel.state.value.savedCount)
        assertTrue(dumps.saved.isEmpty())
    }
}
