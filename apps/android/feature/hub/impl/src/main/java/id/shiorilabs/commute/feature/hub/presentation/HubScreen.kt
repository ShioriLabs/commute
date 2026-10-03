package id.shiorilabs.commute.feature.hub.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.chrisbanes.haze.hazeSource
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.components.ProblemPanel
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.frost.FrostedHeaderPage
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.updatedAgoText
import id.shiorilabs.commute.feature.hub.R
import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.hub.domain.HubKind
import id.shiorilabs.commute.feature.hub.domain.HubMember
import id.shiorilabs.commute.feature.hub.presentation.components.HubHeader
import id.shiorilabs.commute.feature.hub.presentation.components.HubMemberRow
import id.shiorilabs.commute.feature.station.domain.LineInfo

/** The page is white, as on the web, like the station page. */
private val HubBackground = Color.White

/**
 * A hub's page, the web's `/hubs/{slug}`: its name and kind, then its member stations, each opening
 * its own page. While the hub loads, [placeholderTitle] (the name search showed) stands in for the
 * title.
 */
@Composable
fun HubScreen(
    slug: String,
    innerPadding: PaddingValues,
    placeholderTitle: String? = null,
    viewModel: HubViewModel = hiltViewModel<HubViewModel, HubViewModel.Factory>(
        creationCallback = { factory -> factory.create(slug) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val offline by rememberIsOffline()

    HubContent(
        state = state,
        innerPadding = innerPadding,
        offline = offline,
        placeholderTitle = placeholderTitle,
        onClose = { navigator.pop() },
        onRetry = viewModel::retry,
        onOpenStation = { member ->
            navigator.goTo(Route.Station(member.id, title = member.name, lineKeys = member.lineKeys))
        },
    )
}

@Composable
private fun HubContent(
    state: HubUiState,
    innerPadding: PaddingValues,
    offline: Boolean = false,
    placeholderTitle: String? = null,
    onClose: () -> Unit = {},
    onRetry: () -> Unit = {},
    onOpenStation: (HubMember) -> Unit = {},
) {
    FrostedHeaderPage(
        surfaceColor = HubBackground,
        header = {
            HubHeader(
                hub = state.hub,
                placeholderTitle = placeholderTitle,
                onClose = onClose,
                topInset = innerPadding.calculateTopPadding(),
            )
        },
    ) { headerHeight, listState, hazeState ->
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .hazeSource(hazeState),
            contentPadding = PaddingValues(
                top = headerHeight,
                bottom = innerPadding.calculateBottomPadding() + 32.dp,
            ),
        ) {
            when (val hub = state.hub) {
                is UIState.Idle, is UIState.Loading -> items(count = SKELETON_ROWS, key = { "skeleton:$it" }) {
                    MemberSkeleton()
                }

                is UIState.Error -> item(key = "failed") {
                    ProblemPanel(
                        message = stringResource(if (hub.isOffline()) R.string.hub_offline else R.string.hub_failed),
                        retryLabel = stringResource(R.string.hub_retry),
                        onRetry = onRetry,
                        modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
                    )
                }

                is UIState.Success -> {
                    // Over a hub loaded before the connection went, or one that couldn't be
                    // refreshed when it was due: either way, how old it is.
                    if (offline || state.isOutdated) {
                        item(key = "offline-banner") {
                            NoticeBanner(
                                message = stringResource(
                                    if (offline) R.string.hub_offline_banner else R.string.hub_outdated_banner,
                                ),
                                detail = state.updatedAt?.let { updatedAgoText(it) },
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                    val members = hub.data.members
                    itemsIndexed(members, key = { _, member -> "member:${member.id}" }) { index, member ->
                        HubMemberRow(
                            member = member,
                            lines = state.lines,
                            showDivider = index < members.lastIndex,
                            onClick = { onOpenStation(member) },
                        )
                    }
                }
            }
        }
    }
}

/** The web's three skeleton rows: a name's bar over a shorter one for its lines. */
private const val SKELETON_ROWS = 3

@Composable
private fun MemberSkeleton() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SkeletonBlock(
            modifier = Modifier
                .width(160.dp)
                .height(20.dp),
            shape = MaterialTheme.shapes.small,
        )
        SkeletonBlock(
            modifier = Modifier
                .width(96.dp)
                .height(20.dp),
            shape = MaterialTheme.shapes.small,
        )
    }
}

private fun UIState.Error.isOffline(): Boolean = cause?.toFailure() is Failure.Network

private val previewHub = Hub(
    slug = "dukuh-atas",
    name = "Dukuh Atas",
    kind = HubKind.HUB,
    members = listOf(
        HubMember("KCI-SUD", "Sudirman", "KCI", listOf("KCI:C")),
        HubMember("KCI-SUDB", "BNI City", "KCI", listOf("KCI:A", "KCI:C")),
        HubMember("MRTJ-DKA", "Dukuh Atas BNI", "MRTJ", listOf("MRTJ:M")),
    ),
)

private val previewLines = mapOf(
    "KCI:C" to LineInfo("Lin Cikarang", "C", "#25B8EB", "KCI"),
    "KCI:A" to LineInfo("Lin Soekarno-Hatta", "A", "#262262", "KCI"),
    "MRTJ:M" to LineInfo("Lin Utara Selatan", "M", "#CA2A51", "MRTJ"),
)

@Preview(showBackground = true)
@Composable
private fun HubContentPreview() {
    CommutePreviewScaffold {
        HubContent(
            state = HubUiState(hub = UIState.Success(previewHub), lines = previewLines),
            innerPadding = PaddingValues(),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun HubContentLoadingPreview() {
    CommutePreviewScaffold {
        HubContent(
            state = HubUiState(hub = UIState.Loading, lines = emptyMap()),
            innerPadding = PaddingValues(),
            placeholderTitle = "Dukuh Atas",
        )
    }
}
