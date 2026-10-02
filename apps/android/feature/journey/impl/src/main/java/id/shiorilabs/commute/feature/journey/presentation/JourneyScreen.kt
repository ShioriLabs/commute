package id.shiorilabs.commute.feature.journey.presentation

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.rememberJakartaNow
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.JAKARTA
import id.shiorilabs.commute.feature.journey.domain.FareSegment
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLabel
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.ServiceLine
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/**
 * OTW as a page of its own, the web's `/fare`: opened from a station's "OTW Ke Sini", from search's
 * tab, and from a shared link. White like the web's sheet, with the share and close buttons beside
 * the title.
 */
@Composable
fun JourneyScreen(
    route: Route.Journey,
    innerPadding: PaddingValues,
    viewModel: JourneyViewModel = hiltViewModel<JourneyViewModel, JourneyViewModel.Factory>(
        creationCallback = { factory -> factory.create(route) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val picker by viewModel.picker.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val shareTitle = stringResource(R.string.journey_share_title)

    LifecycleResumeEffect(viewModel) {
        viewModel.onResume()
        onPauseOrDispose { }
    }

    JourneyContent(
        state = state,
        picker = picker,
        now = rememberJakartaNow().atZone(JAKARTA).toInstant(),
        innerPadding = innerPadding,
        actions = viewModel.panelActions(),
        onClose = navigator::pop,
        onShare = { url ->
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, url)
                .putExtra(Intent.EXTRA_TITLE, shareTitle)
            context.startActivity(Intent.createChooser(send, shareTitle))
        },
    )
}

@Composable
private fun JourneyContent(
    state: JourneyUiState,
    picker: PickerUiState,
    now: Instant,
    innerPadding: PaddingValues,
    actions: FarePanelActions,
    onClose: () -> Unit,
    onShare: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .verticalScroll(rememberScrollState())
            .padding(
                start = 32.dp,
                top = innerPadding.calculateTopPadding() + 32.dp,
                end = 32.dp,
                bottom = innerPadding.calculateBottomPadding() + 32.dp,
            ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.journey_title),
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            state.shareUrl?.let { url ->
                CommuteIconButton(onClick = { onShare(url) }, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = CommuteIcons.Share,
                        contentDescription = stringResource(R.string.journey_share_description),
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
            CommuteIconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = CommuteIcons.Close,
                    contentDescription = stringResource(R.string.journey_close_description),
                    modifier = Modifier.size(24.dp),
                )
            }
        }
        FarePanel(state = state, picker = picker, now = now, actions = actions)
    }
}

private val previewActions = FarePanelActions({}, {}, {}, {}, {}, {}, {}, {}, {})

@Preview(showBackground = true)
@Composable
private fun JourneyEmptyPreview() {
    CommutePreviewScaffold {
        JourneyContent(
            state = JourneyUiState(),
            picker = PickerUiState(),
            now = Instant.parse("2026-10-05T01:00:00Z"),
            innerPadding = PaddingValues(),
            actions = previewActions,
            onClose = {},
            onShare = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun JourneyNotFoundPreview() {
    CommutePreviewScaffold {
        JourneyContent(
            state = JourneyUiState(
                pair = StationPair("KCI-SUD", "TJ-H00001"),
                origin = PairEndpoint("KCI-SUD", null, "Sudirman"),
                destination = PairEndpoint("TJ-H00001", null, "Bundaran HI"),
                trip = TripState.NotFound,
            ),
            picker = PickerUiState(),
            now = Instant.parse("2026-10-05T01:00:00Z"),
            innerPadding = PaddingValues(),
            actions = previewActions,
            onClose = {},
            onShare = {},
        )
    }
}

private val previewJourney = run {
    val sudirman = JourneyStop("KCI-SUD", "Sudirman")
    val dukuhAtas = JourneyStop("MRTJ-DKA", "Dukuh Atas BNI")
    val lebakBulus = JourneyStop("MRTJ-LBB", "Lebak Bulus Grab")
    Journey(
        legs = listOf(
            JourneyLeg.Transfer(sudirman, dukuhAtas, distanceM = 90, fare = null, corridorLabel = null),
            JourneyLeg.Ride(
                line = "MRTJ:M",
                operator = "MRTJ",
                from = dukuhAtas,
                to = lebakBulus,
                stationCount = 13,
                stops = listOf(dukuhAtas, JourneyStop("MRTJ-BLM", "Blok M BCA"), lebakBulus),
                headsign = "Lebak Bulus Grab",
                distanceM = 15_700,
                serviceLines = listOf(ServiceLine("MRTJ:M", "Lebak Bulus Grab")),
                departureAt = Instant.parse("2026-10-05T02:23:20Z"),
                arrivalAt = Instant.parse("2026-10-05T02:49:50Z"),
                lastService = false,
                platformCode = null,
            ),
        ),
        segments = listOf(FareSegment("MRTJ", dukuhAtas, lebakBulus, 14_000)),
        totalFare = 14_000,
        totalDistanceM = 15_790,
        transferCount = 0,
        labels = listOf(JourneyLabel.LEAST_WALKING),
        boardings = 1,
        walkDistanceM = 90,
        arrivalAt = Instant.parse("2026-10-05T02:49:50Z"),
    )
}

@Preview(showBackground = true, heightDp = 1200)
@Composable
private fun JourneyLoadedPreview() {
    CommutePreviewScaffold {
        JourneyContent(
            state = JourneyUiState(
                pair = StationPair("KCI-SUD", "MRTJ-LBB"),
                origin = PairEndpoint("KCI-SUD", null, "Sudirman"),
                destination = PairEndpoint("MRTJ-LBB", null, "Lebak Bulus Grab"),
                trip = TripState.Loaded(
                    TripAnswer(JourneyStop("KCI-SUD", "Sudirman"), JourneyStop("MRTJ-LBB", "Lebak Bulus Grab"), listOf(previewJourney)),
                ),
                lines = mapOf("MRTJ:M" to LineInfo("MRT Lin Utara-Selatan", "M", "#DD0067", "MRTJ")),
                shareUrl = "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB",
            ),
            picker = PickerUiState(),
            now = Instant.parse("2026-10-05T01:00:00Z"),
            innerPadding = PaddingValues(),
            actions = previewActions,
            onClose = {},
            onShare = {},
        )
    }
}
