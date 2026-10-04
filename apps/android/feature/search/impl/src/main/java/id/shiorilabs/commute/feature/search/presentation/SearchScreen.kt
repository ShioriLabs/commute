package id.shiorilabs.commute.feature.search.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.datastore.SearchMode
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.PillToggle
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.core.ui.ext.rowEntrance
import id.shiorilabs.commute.core.ui.morph.NAV_CARD_MORPH_MILLIS
import id.shiorilabs.commute.core.ui.morph.NavCardMorphTarget
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.journey.presentation.OtwPanel
import id.shiorilabs.commute.feature.search.R
import id.shiorilabs.commute.feature.search.domain.MIN_QUERY_LENGTH
import id.shiorilabs.commute.feature.search.domain.SearchLine
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.presentation.components.LineChips
import id.shiorilabs.commute.feature.search.presentation.components.RecentHeader
import id.shiorilabs.commute.feature.search.presentation.components.SavedChips
import id.shiorilabs.commute.feature.search.presentation.components.SearchError
import id.shiorilabs.commute.feature.search.presentation.components.SearchHeader
import id.shiorilabs.commute.feature.search.presentation.components.SearchNotFound
import id.shiorilabs.commute.feature.search.presentation.components.SearchResultItem
import id.shiorilabs.commute.feature.search.presentation.components.SearchResultsSkeleton
import id.shiorilabs.commute.feature.search.presentation.components.SectionLabelColor
import kotlinx.coroutines.delay

/** Where an opened row sat, for telling a pinned chip from the same station's recent. */
private const val SOURCE_CHIP = "chip"
private const val SOURCE_RECENT = "recent"
private const val SOURCE_RESULT = "result"

/** The sheet the morph opens onto is white, not the app's tinted background, as on web. */
private val SearchBackground = Color.White

@Composable
fun SearchScreen(
    innerPadding: PaddingValues,
    otwPanel: OtwPanel,
    /** The pair search was opened with as [Route.Otw], or `null` from home's card. */
    otwSeed: Route.Otw? = null,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val query by viewModel.query.collectAsStateWithLifecycle()
    val storedMode by viewModel.mode.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val focusManager = LocalFocusManager.current

    // Opened with a pair, the OTW tab shows for this visit until the rider picks a tab, without
    // touching the tab home's card remembers.
    var seeded by rememberSaveable { mutableStateOf(otwSeed != null) }
    val mode = if (seeded) SearchMode.FARE else storedMode

    val content = @Composable {
        SearchContent(
            state = state,
            query = query,
            mode = mode,
            innerPadding = innerPadding,
            onModeChange = { next ->
                // The OTW tab has no use for the station field's keyboard.
                focusManager.clearFocus()
                seeded = false
                viewModel.onModeChange(next)
            },
            otwContent = { padding ->
                otwPanel.Content(seed = otwSeed, contentPadding = padding, modifier = Modifier.fillMaxSize())
            },
            onQueryChange = viewModel::onQueryChange,
            onClose = {
                // The keyboard would otherwise slide away against the collapsing screen.
                focusManager.clearFocus()
                navigator.pop()
            },
            onRetry = viewModel::retry,
            // Recorded as a recent search first, as the web does before navigating, then opens the
            // station's, hub's or line's page.
            onResultClick = { searchable ->
                viewModel.onResultClick(searchable)
                routeFor(searchable)?.let { route ->
                    focusManager.clearFocus()
                    navigator.goTo(route)
                }
            },
            onTogglePin = viewModel::onToggleSave,
            onClearRecents = viewModel::onClearRecents,
            onEditPins = {
                focusManager.clearFocus()
                navigator.goTo(Route.SettingsSavedStations)
            },
            focusOnOpen = otwSeed == null,
        )
    }

    if (otwSeed == null) {
        // Opened by the home screen's accent card, so this gathers back into its colour.
        NavCardMorphTarget(
            destination = Route.Search,
            cardTint = MaterialTheme.colorScheme.primary,
        ) {
            content()
        }
    } else {
        // Opened from a station's page or a saved pair: it slides in as any other page does.
        content()
    }
}

@Composable
private fun SearchContent(
    state: UIState<SearchUiState>,
    query: String,
    mode: SearchMode?,
    innerPadding: PaddingValues,
    onModeChange: (SearchMode) -> Unit,
    otwContent: @Composable (PaddingValues) -> Unit,
    onQueryChange: (String) -> Unit,
    onClose: () -> Unit,
    onRetry: () -> Unit,
    onResultClick: (Searchable) -> Unit,
    onTogglePin: (stationId: String) -> Unit,
    onClearRecents: () -> Unit,
    onEditPins: () -> Unit = {},
    focusOnOpen: Boolean = true,
) {
    val focusRequester = remember { FocusRequester() }

    // The row the rider last opened, by where it sits as well as what it is: the same station can
    // show twice at once, as a pinned chip and a recent, and only the one tapped flies into the
    // station page, and back.
    var opened by rememberSaveable { mutableStateOf<String?>(null) }
    val openFrom = { source: String, searchable: Searchable ->
        opened = "$source:${searchable.key}"
        onResultClick(searchable)
    }

    // Focused once the morph has settled, so the keyboard doesn't slide up against the expanding
    // screen. The web waits the same 250 ms. Not on the OTW tab, which has no field to type in.
    val currentMode by rememberUpdatedState(mode)
    if (focusOnOpen) {
        LaunchedEffect(focusRequester) {
            delay(NAV_CARD_MORPH_MILLIS.toLong())
            if (currentMode != SearchMode.FARE) {
                focusRequester.requestFocus()
            }
        }
    }

    // The idle state carries most of this screen's nodes and none of what the tap was for, so it
    // joins one frame after the header rather than in the frame the morph starts on.
    var idleMounted by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        idleMounted = true
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SearchBackground)
            .padding(top = innerPadding.calculateTopPadding()),
    ) {
        val searching = query.length >= MIN_QUERY_LENGTH
        val loaded = (state as? UIState.Success)?.data

        SearchHeader(
            query = query,
            onQueryChange = onQueryChange,
            onClose = onClose,
            focusRequester = focusRequester,
            showField = mode != SearchMode.FARE,
            aboveField = {
                PillToggle(
                    options = listOf(stringResource(R.string.search_mode_station), stringResource(R.string.search_mode_otw)),
                    selected = if (mode == SearchMode.FARE) 1 else 0,
                    onSelect = { onModeChange(if (it == 1) SearchMode.FARE else SearchMode.STATION) },
                    description = stringResource(R.string.search_mode_description),
                    modifier = Modifier.padding(top = 16.dp),
                )
            },
            belowField = {
                if (!searching && idleMounted && loaded != null) {
                    SavedChips(
                        stations = loaded.idle.saved,
                        onClick = { openFrom(SOURCE_CHIP, it) },
                        onEdit = onEditPins,
                        isShared = { opened == "$SOURCE_CHIP:${it.key}" },
                    )
                }
            },
        )
        if (mode == SearchMode.FARE) {
            val insets = WindowInsets.navigationBars.asPaddingValues()
            otwContent(PaddingValues(start = 32.dp, end = 32.dp, bottom = insets.calculateBottomPadding() + 32.dp))
            return@Column
        }
        // Each query's results start at the top. The list otherwise holds on to its first visible
        // row by key, so once scrolled, a better match ranked in above that row stayed out of sight.
        val listState = rememberLazyListState()
        val resultsQuery = ((state as? UIState.Success)?.data?.results as? SearchResults.Found)?.query
        LaunchedEffect(resultsQuery) {
            if (resultsQuery != null) {
                listState.scrollToItem(0)
            }
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = WindowInsets.ime.union(WindowInsets.navigationBars).asPaddingValues(),
        ) {
            when (state) {
                is UIState.Idle, is UIState.Loading -> if (searching) {
                    item(key = "search-skeleton") {
                        SearchResultsSkeleton(Modifier.padding(top = 16.dp))
                    }
                }

                is UIState.Error -> item(key = "search-error") {
                    SearchError(
                        message = state.message.orEmpty(),
                        onRetry = onRetry,
                    )
                }

                is UIState.Success -> when (val results = state.data.results) {
                    is SearchResults.None -> if (idleMounted) {
                        idleContent(
                            idle = state.data.idle,
                            savedStationIds = state.data.savedStationIds,
                            onClick = { openFrom(SOURCE_RECENT, it) },
                            onTogglePin = onTogglePin,
                            onClearRecents = onClearRecents,
                            opened = opened,
                        )
                    }

                    is SearchResults.Found -> {
                        item(key = "search-results-top") {
                            VerticalSpacer(16.dp)
                        }
                        itemsIndexed(results.items, key = { _, it -> "search-result:${it.key}" }) { index, searchable ->
                            SearchResultItem(
                                searchable = searchable,
                                query = results.query,
                                onClick = { openFrom(SOURCE_RESULT, searchable) },
                                pinned = searchable.isPinned(state.data.savedStationIds),
                                onTogglePin = onTogglePin,
                                // Keyed rows, so a row that stays across a keystroke keeps its
                                // place and only the newcomers rise in.
                                modifier = Modifier.rowEntrance(index),
                                showDivider = index < results.items.lastIndex,
                                shared = opened == "$SOURCE_RESULT:${searchable.key}",
                            )
                        }
                    }

                    is SearchResults.NotFound -> item(key = "search-not-found") {
                        SearchNotFound()
                    }
                }
            }
        }
    }
}

private fun Searchable.isPinned(savedStationIds: Set<String>): Boolean =
    this is Searchable.Station && stationId in savedStationIds

/**
 * The page a result opens, carrying what its row shows (name, roundels, colour) for the page's
 * first frame; null for an entry too malformed to name one.
 */
internal fun routeFor(searchable: Searchable): Route? = when (searchable) {
    is Searchable.Station -> searchable.stationId?.let { stationId ->
        Route.Station(stationId = stationId, title = searchable.title, lineKeys = searchable.lines.map { it.key })
    }

    // The slug is the hub's `hub-id`, or else the tail of its `/hubs/{slug}` link.
    is Searchable.Hub -> (searchable.hubId ?: searchable.to.substringAfter("/hubs/", "").ifEmpty { null })
        ?.let { slug -> Route.Hub(slug, title = searchable.title) }

    is Searchable.Line -> Route.Line(
        operator = searchable.operator,
        lineCode = searchable.line.lineCode,
        title = searchable.line.name,
        colorCode = searchable.line.colorCode,
    )
}

private fun LazyListScope.idleContent(
    idle: IdleContent,
    savedStationIds: Set<String>,
    onClick: (Searchable) -> Unit,
    onTogglePin: (stationId: String) -> Unit,
    onClearRecents: () -> Unit,
    opened: String?,
) {
    if (idle.recents.isNotEmpty()) {
        item(key = "search-recent-header") {
            RecentHeader(
                onClear = onClearRecents,
                modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
            )
        }
        itemsIndexed(idle.recents, key = { _, it -> "search-recent:${it.key}" }) { index, searchable ->
            SearchResultItem(
                searchable = searchable,
                query = "",
                onClick = { onClick(searchable) },
                pinned = searchable.isPinned(savedStationIds),
                onTogglePin = onTogglePin,
                modifier = Modifier.rowEntrance(index),
                showDivider = index < idle.recents.lastIndex,
                shared = opened == "$SOURCE_RECENT:${searchable.key}",
            )
        }
    } else if (idle.saved.isEmpty()) {
        item(key = "search-idle-hint") {
            Text(
                text = stringResource(R.string.search_idle_hint),
                modifier = Modifier.padding(start = 32.dp, top = 16.dp, end = 32.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = SectionLabelColor,
            )
        }
    }
    if (idle.lines.isNotEmpty()) {
        item(key = "search-lines") {
            LineChips(
                title = stringResource(R.string.search_lines),
                lines = idle.lines,
                onClick = onClick,
                modifier = Modifier.padding(top = 24.dp, bottom = 32.dp),
            )
        }
    }
}

private val previewManggarai = Searchable.Station(
    title = "Manggarai",
    to = "/stations/KCI/MRI",
    keywords = listOf("manggarai", "mri"),
    subtitle = "Commuter Line",
    score = 95.0,
    stationId = "KCI-MRI",
    operator = "KCI",
    lines = listOf(SearchLine("Lin Bogor", "B", "#EE3D43", "KCI")),
)

private val previewLine = Searchable.Line(
    title = "Lin Cikarang",
    to = "/lines/KCI/C",
    keywords = listOf("lin cikarang"),
    subtitle = "Commuter Line",
    score = null,
    operator = "KCI",
    line = SearchLine("Lin Cikarang", "C", "#25B8EB", "KCI"),
)

@Preview(showBackground = true)
@Composable
private fun SearchIdlePreview() {
    CommutePreviewScaffold {
        SearchContent(
            state = UIState.Success(
                SearchUiState(
                    idle = IdleContent(
                        saved = listOf(previewManggarai),
                        recents = listOf(previewManggarai),
                        lines = listOf(previewLine),
                    ),
                    results = SearchResults.None,
                    savedStationIds = setOf("KCI-MRI"),
                ),
            ),
            query = "",
            mode = SearchMode.STATION,
            innerPadding = PaddingValues(),
            onModeChange = {},
            otwContent = {},
            onQueryChange = {},
            onClose = {},
            onRetry = {},
            onResultClick = {},
            onTogglePin = {},
            onClearRecents = {},
            focusOnOpen = false,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SearchResultsPreview() {
    CommutePreviewScaffold {
        SearchContent(
            state = UIState.Success(
                SearchUiState(
                    idle = IdleContent(emptyList(), emptyList(), emptyList()),
                    results = SearchResults.Found("mang", listOf(previewManggarai)),
                    savedStationIds = emptySet(),
                ),
            ),
            query = "mang",
            mode = SearchMode.STATION,
            innerPadding = PaddingValues(),
            onModeChange = {},
            otwContent = {},
            onQueryChange = {},
            onClose = {},
            onRetry = {},
            onResultClick = {},
            onTogglePin = {},
            onClearRecents = {},
            focusOnOpen = false,
        )
    }
}
