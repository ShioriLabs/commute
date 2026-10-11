package id.shiorilabs.commute.core.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class ReportIssueLinkTest {

    @Test
    fun `without a page the form opens bare`() {
        assertEquals("https://tally.so/r/68BvJe", reportIssueUrl())
        assertEquals("https://tally.so/r/68BvJe", reportIssueUrl(""))
    }

    @Test
    fun `a page fills the halaman field as one value, its own query and all`() {
        assertEquals(
            "https://tally.so/r/68BvJe?halaman=https%3A%2F%2Fcommute.shiorilabs.id%2Fstations%2FKCI%2FMRI",
            reportIssueUrl("https://commute.shiorilabs.id/stations/KCI/MRI"),
        )
        assertEquals(
            "https://tally.so/r/68BvJe?halaman=https%3A%2F%2Fcommute.shiorilabs.id%2Ffare%3Ffrom%3DKCI-SUD%26to%3DKCI-MRI",
            reportIssueUrl("https://commute.shiorilabs.id/fare?from=KCI-SUD&to=KCI-MRI"),
        )
    }
}
