package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.core.query.Refetched
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RefreshNoticeTest {

    @Test
    fun `nothing pinned says nothing`() {
        assertNull(RefreshNotice.of(emptyList()))
    }

    @Test
    fun `everything confirmed is up to date`() {
        assertEquals(RefreshNotice.UpToDate, RefreshNotice.of(listOf(Refetched(unchanged = 3), Refetched(unchanged = 1))))
    }

    @Test
    fun `entries are counted, not their parts`() {
        val notice = RefreshNotice.of(
            listOf(Refetched(changed = 2, unchanged = 1), Refetched(unchanged = 1), Refetched(changed = 1)),
        )

        assertEquals(RefreshNotice.Updated(2), notice)
    }

    @Test
    fun `a failure outranks what changed, and says whether it was all of them`() {
        assertEquals(
            RefreshNotice.Failed(all = false),
            RefreshNotice.of(listOf(Refetched(changed = 1), Refetched(failed = 3))),
        )
        assertEquals(RefreshNotice.Failed(all = true), RefreshNotice.of(listOf(Refetched(failed = 3), Refetched(failed = 1))))
    }

    @Test
    fun `an entry that changed in part counts as changed, not failed`() {
        assertEquals(RefreshNotice.Updated(1), RefreshNotice.of(listOf(Refetched(changed = 1, failed = 1))))
    }
}
