package id.shiorilabs.commute.core.ui.startup

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StartupGateTest {

    @Test
    fun `with nothing held the first frame may draw`() {
        assertTrue(StartupGate().isOpen)
    }

    @Test
    fun `the first frame waits until every hold is released`() {
        val gate = StartupGate()
        val feed = gate.hold()
        val card = gate.hold()
        assertFalse(gate.isOpen)

        feed()
        assertFalse(gate.isOpen)
        card()

        assertTrue(gate.isOpen)
    }

    @Test
    fun `releasing a hold twice counts once`() {
        val gate = StartupGate()
        val feed = gate.hold()
        gate.hold()

        feed()
        feed()

        assertFalse(gate.isOpen)
    }

    @Test
    fun `once the first frame has drawn, holds no longer count`() {
        val gate = StartupGate()
        gate.hold()
        gate.open()

        gate.hold()

        assertTrue(gate.isOpen)
    }
}
