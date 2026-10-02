package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * The OTW panel (Dari/Ke, settings and results), for the search screen's OTW tab.
 *
 * A seam rather than a shared composable: search may not depend on journey's implementation, so it
 * is handed this, bound by the journey feature. The panel keeps its state for as long as the screen
 * hosting it, so a round trip through the other tab keeps the chosen pair, as on the web.
 */
interface OtwPanel {

    @Composable
    fun Content(contentPadding: PaddingValues, modifier: Modifier)
}
