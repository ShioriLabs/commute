package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.station.domain.LineInfo

/**
 * The answer: the options to choose between, each opening its journey's trip page. A lone journey
 * is a card of its own, with no count above it. The options half of the web's `FareResultCard`.
 */
@Composable
internal fun JourneyResult(
    journeys: List<Journey>,
    lines: Map<String, LineInfo>,
    onSelect: (Journey) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        if (journeys.size > 1) {
            Box(modifier = Modifier.height(32.dp), contentAlignment = Alignment.CenterStart) {
                Text(
                    text = stringResource(R.string.journey_options, journeys.size),
                    modifier = Modifier.semantics { heading() },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = Slate500,
                )
            }
        }
        Column(
            modifier = Modifier.padding(top = if (journeys.size > 1) 8.dp else 0.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            journeys.forEach { journey ->
                JourneyCard(journey = journey, lines = lines, onClick = { onSelect(journey) })
            }
        }
    }
}
