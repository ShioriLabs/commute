package id.shiorilabs.commute.feature.card.presentation

import android.content.Intent
import id.shiorilabs.commute.feature.card.dump.CardDump
import id.shiorilabs.commute.feature.card.dump.CardDumps
import id.shiorilabs.commute.feature.card.felica.FakeCard
import id.shiorilabs.commute.feature.card.felica.IDM
import id.shiorilabs.commute.feature.card.felica.PMM
import id.shiorilabs.commute.feature.card.felica.TappedCard
import id.shiorilabs.commute.feature.card.felica.blocks
import id.shiorilabs.commute.feature.card.felica.hex
import id.shiorilabs.commute.feature.card.iso.FakeIsoCard
import id.shiorilabs.commute.feature.card.iso.IsoCommand
import id.shiorilabs.commute.feature.card.iso.IsoProbe
import id.shiorilabs.commute.feature.card.iso.IsoTag
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
    fun `a card that isn't FeliCa is kept as Android found it`() {
        val viewModel = CardDumperViewModel(dumps)

        viewModel.identify(
            IsoTag(
                techs = listOf("android.nfc.tech.IsoDep", "android.nfc.tech.NfcA"),
                id = hex("04 A1 B2 C3"),
                atqa = hex("04 00"),
                sak = 0x20,
                historicalBytes = hex("80 31"),
            ),
            transport = null,
        )

        val state = viewModel.state.value
        assertEquals(CardDumperUiState.Phase.Done, state.phase)
        assertNull(state.dump!!.tag)
        assertEquals(
            CardDump.IsoDump(techs = listOf("IsoDep", "NfcA"), id = "04A1B2C3", atqa = "0400", sak = "20", historicalBytes = "8031"),
            state.dump!!.iso,
        )
    }

    @Test
    fun `an ISO-DEP card goes through the injected probes`() {
        val probe = IsoProbe { send -> send(IsoCommand.select("PROBED".encodeToByteArray())) }
        val viewModel = CardDumperViewModel(dumps, setOf(probe))

        viewModel.identify(IsoTag(techs = listOf("android.nfc.tech.IsoDep"), id = hex("04 A1 B2 C3")), FakeIsoCard())

        assertEquals("00A404000650524F42454400", viewModel.state.value.dump!!.transcript.last().tx)
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
