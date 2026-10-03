package id.shiorilabs.commute.feature.line.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
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
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteEmptyState
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.frost.FrostedHeaderPage
import id.shiorilabs.commute.core.ui.network.rememberIsOffline
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.time.updatedAgoText
import id.shiorilabs.commute.feature.line.R
import id.shiorilabs.commute.feature.line.domain.LineDetail
import id.shiorilabs.commute.feature.line.domain.LineSegment
import id.shiorilabs.commute.feature.line.domain.LineStop
import id.shiorilabs.commute.feature.line.domain.SegmentKind
import id.shiorilabs.commute.feature.line.domain.lineStrip
import id.shiorilabs.commute.feature.line.presentation.components.LineHeader
import id.shiorilabs.commute.feature.line.presentation.components.LineStripView
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.core.ui.R as CoreUiR

/** The page is white, as on the web, like the station page. */
private val LineBackground = Color.White

/** The web's `max-w-md`, which the strip and its skeleton are centred in. */
private val ContentMaxWidth = 448.dp

/**
 * A line's page, the web's `/lines/{operator}/{lineCode}`: its roundel and name, then its stations
 * down a rail in its colour. While the line loads, [placeholderTitle] and [placeholderColor] (what
 * the opener showed of it) stand in for the header.
 */
@Composable
fun LineScreen(
    operator: String,
    lineCode: String,
    innerPadding: PaddingValues,
    placeholderTitle: String? = null,
    placeholderColor: String? = null,
    viewModel: LineViewModel = hiltViewModel<LineViewModel, LineViewModel.Factory>(
        creationCallback = { factory -> factory.create(operator, lineCode) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val offline by rememberIsOffline()

    LineContent(
        state = state,
        operator = operator,
        lineCode = lineCode,
        innerPadding = innerPadding,
        offline = offline,
        placeholderTitle = placeholderTitle,
        placeholderColor = placeholderColor,
        onClose = { navigator.pop() },
        onRetry = viewModel::retry,
        onShowBranch = viewModel::onShowBranch,
        onOpenStation = { stop -> navigator.goTo(Route.Station(stop.id, title = stop.name)) },
        onOpenLine = { line ->
            navigator.goTo(Route.Line(line.operator, line.lineCode, title = line.name, colorCode = line.colorCode))
        },
    )
}

@Composable
private fun LineContent(
    state: LineUiState,
    operator: String,
    lineCode: String,
    innerPadding: PaddingValues,
    offline: Boolean = false,
    placeholderTitle: String? = null,
    placeholderColor: String? = null,
    onClose: () -> Unit = {},
    onRetry: () -> Unit = {},
    onShowBranch: (Int) -> Unit = {},
    onOpenStation: (LineStop) -> Unit = {},
    onOpenLine: (LineInfo) -> Unit = {},
) {
    FrostedHeaderPage(
        surfaceColor = LineBackground,
        header = {
            LineHeader(
                line = state.line,
                operator = operator,
                lineCode = lineCode,
                onClose = onClose,
                placeholderTitle = placeholderTitle,
                placeholderColor = placeholderColor,
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
                start = 16.dp,
                top = headerHeight + 8.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 48.dp,
            ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (val line = state.line) {
                is UIState.Idle, is UIState.Loading -> item(key = "loading") { StripSkeleton() }

                is UIState.Error -> item(key = "failed") {
                    LineProblem(offline = line.isOffline(), onRetry = onRetry)
                }

                is UIState.Success -> {
                    // Over a line loaded before the connection went, or one that couldn't be
                    // refreshed when it was due: either way, how old it is.
                    if (offline || state.isOutdated) {
                        item(key = "offline-banner") {
                            NoticeBanner(
                                message = stringResource(
                                    if (offline) R.string.line_offline_banner else R.string.line_outdated_banner,
                                ),
                                detail = state.updatedAt?.let { updatedAgoText(it) },
                                modifier = Modifier
                                    .widthIn(max = ContentMaxWidth)
                                    .padding(bottom = 16.dp),
                            )
                        }
                    }
                    val strip = state.strip ?: return@LazyColumn
                    // One item: the loop's ring is drawn under the junction's row, which only
                    // siblings in one layout can arrange.
                    item(key = "strip") {
                        LineStripView(
                            strip = strip,
                            colorCode = line.data.colorCode,
                            operator = line.data.operator,
                            lines = state.lines,
                            onOpenStation = onOpenStation,
                            onOpenLine = onOpenLine,
                            onShowBranch = onShowBranch,
                        )
                    }
                }
            }
        }
    }
}

/** The web's loading strip: a pill, then eight bars. */
@Composable
private fun StripSkeleton() {
    Column(
        modifier = Modifier
            .widthIn(max = ContentMaxWidth)
            .fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SkeletonBlock(
            modifier = Modifier
                .width(160.dp)
                .height(28.dp),
            shape = CircleShape,
        )
        repeat(SKELETON_BARS) {
            SkeletonBlock(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(40.dp),
            )
        }
    }
}

private const val SKELETON_BARS = 8

/** The web's EmptyState, offline or failed, with its retry. */
@Composable
private fun LineProblem(offline: Boolean, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        CommuteEmptyState(
            illustration = painterResource(CoreUiR.drawable.img_search_empty),
            illustrationDescription = stringResource(R.string.line_illustration_description),
            title = stringResource(if (offline) R.string.line_offline_title else R.string.line_failed_title),
            body = AnnotatedString(
                stringResource(if (offline) R.string.line_offline_body else R.string.line_failed_body),
            ),
        )
        CommuteButton(text = stringResource(R.string.line_retry), onClick = onRetry)
    }
}

private fun UIState.Error.isOffline(): Boolean = cause?.toFailure() is Failure.Network

private val previewLine = LineDetail(
    operator = "KCI",
    operatorName = "Commuter Line",
    name = "Lin Tangerang",
    lineCode = "T",
    colorCode = "#C15F28",
    segments = listOf(
        LineSegment(
            kind = SegmentKind.TRUNK,
            joinsAtCode = null,
            stations = listOf(
                LineStop("KCI-DU", "DU", "Duri", "T01", true, listOf("KCI:C")),
                LineStop("KCI-GRG", "GRG", "Grogol", "T02", false, emptyList()),
                LineStop("KCI-TNG", "TNG", "Tangerang", "T11", false, emptyList()),
            ),
        ),
    ),
)

@Preview(showBackground = true)
@Composable
private fun LineContentPreview() {
    CommutePreviewScaffold {
        LineContent(
            state = LineUiState(
                line = UIState.Success(previewLine),
                strip = lineStrip(previewLine),
                lines = mapOf("KCI:C" to LineInfo("Lin Cikarang", "C", "#25B8EB", "KCI")),
            ),
            operator = "KCI",
            lineCode = "T",
            innerPadding = PaddingValues(),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LineContentFailedPreview() {
    CommutePreviewScaffold {
        LineContent(
            state = LineUiState(line = UIState.Error()),
            operator = "KCI",
            lineCode = "T",
            innerPadding = PaddingValues(),
        )
    }
}
