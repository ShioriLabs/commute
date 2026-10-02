package id.shiorilabs.commute.feature.journey.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.presentation.components.Amber100
import id.shiorilabs.commute.feature.journey.presentation.components.Amber950
import id.shiorilabs.commute.feature.journey.presentation.components.CriteriaBar
import id.shiorilabs.commute.feature.journey.presentation.components.JourneyResult
import id.shiorilabs.commute.feature.journey.presentation.components.OptionPlate
import id.shiorilabs.commute.feature.journey.presentation.components.Slate400
import id.shiorilabs.commute.feature.journey.presentation.components.StationFields
import id.shiorilabs.commute.feature.journey.presentation.components.StationPickerSheet
import id.shiorilabs.commute.feature.journey.presentation.components.Stone100
import id.shiorilabs.commute.feature.journey.presentation.components.Stone200
import java.time.Instant

/** What the panel can be asked to do. One object, so the two hosts wire it the same way. */
internal class FarePanelActions(
    val onPick: (PairEnd) -> Unit,
    val onSwap: () -> Unit,
    val onCriteriaChange: (JourneyCriteria) -> Unit,
    val onSelectJourney: (Int) -> Unit,
    val onBackToOptions: () -> Unit,
    val onRetry: () -> Unit,
    val onPickerQueryChange: (String) -> Unit,
    val onPickStation: (PickableStation) -> Unit,
    val onClosePicker: () -> Unit,
)

internal fun JourneyViewModel.panelActions() = FarePanelActions(
    onPick = ::openPicker,
    onSwap = ::onSwap,
    onCriteriaChange = ::onCriteriaChange,
    onSelectJourney = ::onSelectJourney,
    onBackToOptions = ::onBackToOptions,
    onRetry = ::retry,
    onPickerQueryChange = ::onPickerQueryChange,
    onPickStation = ::onPick,
    onClosePicker = ::closePicker,
)

/**
 * The OTW panel: the Dari/Ke fields, the settings, then the answer, with the station picker over it
 * when one end is being chosen. Rendered by the OTW page and by search's OTW tab, which scroll it.
 * The web's `FarePanel`. [footer] follows a loaded answer.
 */
@Composable
internal fun FarePanel(
    state: JourneyUiState,
    picker: PickerUiState,
    now: Instant,
    actions: FarePanelActions,
    modifier: Modifier = Modifier,
    footer: @Composable () -> Unit = {},
) {
    Column(modifier = modifier.fillMaxWidth()) {
        StationFields(
            origin = state.origin,
            destination = state.destination,
            onPickOrigin = { actions.onPick(PairEnd.ORIGIN) },
            onPickDestination = { actions.onPick(PairEnd.DESTINATION) },
            onSwap = actions.onSwap,
            modifier = Modifier.padding(top = 16.dp),
        )
        CriteriaBar(criteria = state.criteria, now = now, onChange = actions.onCriteriaChange)

        when (val trip = state.trip) {
            TripState.Idle -> if (state.origin == null || state.destination == null) {
                EmptyPair()
            }

            TripState.Loading -> ResultSkeleton()

            TripState.NotFound -> Problem(text = stringResource(R.string.journey_not_found))

            TripState.Failed -> Problem(text = stringResource(R.string.journey_failed), onRetry = actions.onRetry)

            is TripState.Loaded -> {
                JourneyResult(
                    journeys = trip.answer.journeys,
                    page = state.page,
                    selected = state.selected,
                    lines = state.lines,
                    onSelect = actions.onSelectJourney,
                    onBack = actions.onBackToOptions,
                    modifier = Modifier.padding(top = 24.dp),
                )
                footer()
            }
        }
    }

    state.picker?.let { end ->
        StationPickerSheet(
            end = end,
            picker = picker,
            selectedId = if (end == PairEnd.ORIGIN) state.pair.fromId else state.pair.toId,
            onQueryChange = actions.onPickerQueryChange,
            onPick = actions.onPickStation,
            onDismiss = actions.onClosePicker,
        )
    }
}

@Composable
private fun EmptyPair() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(imageVector = CommuteIcons.Pair, contentDescription = null, modifier = Modifier.size(48.dp), tint = Slate400)
        Text(
            text = stringResource(R.string.journey_empty),
            style = MaterialTheme.typography.bodyLarge,
            color = Slate400,
            textAlign = TextAlign.Center,
        )
    }
}

/** A plate's outline, pulsing, while the answer is worked out. */
@Composable
private fun ResultSkeleton() {
    val description = stringResource(R.string.journey_loading_description)
    Column(
        modifier = Modifier
            .padding(top = 24.dp)
            .semantics { contentDescription = description },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(OptionPlate, MaterialTheme.shapes.extraSmall)
                .padding(16.dp),
        ) {
            SkeletonBlock(Modifier.fillMaxWidth().height(28.dp), MaterialTheme.shapes.extraSmall)
            Row(modifier = Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SkeletonBlock(Modifier.width(96.dp).height(20.dp), MaterialTheme.shapes.extraSmall)
                SkeletonBlock(Modifier.width(80.dp).height(12.dp), MaterialTheme.shapes.extraSmall)
            }
            SkeletonBlock(Modifier.padding(top = 6.dp).width(160.dp).height(12.dp), MaterialTheme.shapes.extraSmall)
        }
        SkeletonBlock(Modifier.padding(top = 24.dp).width(192.dp).height(16.dp), MaterialTheme.shapes.extraSmall)
        SkeletonBlock(Modifier.padding(top = 8.dp).width(128.dp).height(16.dp), MaterialTheme.shapes.extraSmall)
    }
}

/** The web's amber notice. A failed load can be tried again here; a phone loses signal more often. */
@Composable
private fun Problem(text: String, onRetry: (() -> Unit)? = null) {
    Column(
        modifier = Modifier
            .padding(top = 24.dp)
            .fillMaxWidth()
            .background(Amber100, MaterialTheme.shapes.medium)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(text = text, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Amber950)
        if (onRetry != null) {
            Text(
                text = stringResource(R.string.journey_retry),
                modifier = Modifier.clickable(role = Role.Button, onClick = onRetry),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/** "Buka halaman tarif": from search's tab to the OTW page for the same pair. */
@Composable
internal fun OpenFarePageLink(onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .padding(top = 16.dp)
            .fillMaxWidth()
            .background(Stone100, MaterialTheme.shapes.medium)
            .border(2.dp, Stone200, MaterialTheme.shapes.medium)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = stringResource(R.string.journey_open_page), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
        Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(16.dp))
    }
}
