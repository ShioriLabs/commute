package id.shiorilabs.commute.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.wearable.WearDirection
import id.shiorilabs.commute.core.wearable.WearStation
import kotlinx.coroutines.launch

/**
 * Sets up one "Keberangkatan" slot as it is added to a watch face: a saved station, then the line
 * and direction to show. The stations are the phone's saved ones, as it last sent them.
 */
class DeparturesConfigActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val complicationId = intent.getIntExtra(ComplicationDataSourceService.EXTRA_CONFIG_COMPLICATION_ID, NO_SLOT)
        setResult(RESULT_CANCELED)
        if (complicationId == NO_SLOT) {
            finish()
            return
        }
        val store = SavedStationsStore(this)
        val phone = PhoneLink(this)
        // A watch set up before the phone sent anything: ask now, and the list fills as it lands.
        lifecycleScope.launch { if (store.all().isEmpty()) phone.requestSavedSync(null) }
        setContent {
            CommuteWatchTheme {
                AppScaffold {
                    DeparturesSetup(store, phone) { station, direction ->
                        val activity = this@DeparturesConfigActivity
                        ComplicationSlots(activity).set(complicationId, SlotChoice(station.id, direction.key))
                        DeparturesComplicationService.update(activity, complicationId)
                        setResult(RESULT_OK)
                        finish()
                    }
                }
            }
        }
    }

    private companion object {

        const val NO_SLOT = -1
    }
}

@Composable
private fun DeparturesSetup(store: SavedStationsStore, phone: PhoneLink, onPick: (WearStation, WearDirection) -> Unit) {
    val stations by remember(store) { store.stations }.collectAsStateWithLifecycle(initialValue = null)
    var pickedId by rememberSaveable { mutableStateOf<String?>(null) }
    val picked = stations?.firstOrNull { it.id == pickedId }
    BackHandler(enabled = picked != null) { pickedId = null }
    val loaded = stations ?: return
    when {
        loaded.isEmpty() -> NoStations(phone)
        picked == null -> Choices(stringResource(R.string.config_stations), loaded.sortedBy { it.name }, { it.id }) { station ->
            StationButton(station) { pickedId = station.id }
        }
        else -> Choices(picked.name, picked.directions, { it.key }) { direction ->
            DirectionButton(direction) { onPick(picked, direction) }
        }
    }
}

/** A header and a button per item, as Wear lists a choice. */
@Composable
private fun <T : Any> Choices(title: String, items: List<T>, key: (T) -> Any, button: @Composable (T) -> Unit) {
    val listState = rememberTransformingLazyColumnState()
    ScreenScaffold(scrollState = listState) { padding ->
        TransformingLazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text(title, textAlign = TextAlign.Center) } }
            items(items, key = key) { button(it) }
        }
    }
}

@Composable
private fun StationButton(station: WearStation, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.filledTonalButtonColors(),
        modifier = Modifier.fillMaxWidth(),
        label = { Text(station.name) },
    )
}

/** The line's colour, its name and where it heads, and the platform where it's known. */
@Composable
private fun DirectionButton(direction: WearDirection, onClick: () -> Unit) {
    val platform = direction.platform?.let { stringResource(CopyR.string.trip_platform, it.replace(PLATFORM_SLASH, "·")) }
    Button(
        onClick = onClick,
        colors = ButtonDefaults.filledTonalButtonColors(),
        modifier = Modifier.fillMaxWidth(),
        icon = { Box(Modifier.size(DOT).background(Color(direction.color), CircleShape)) },
        secondaryLabel = {
            Text(
                listOfNotNull(stringResource(R.string.config_toward, direction.label), platform).joinToString(WatchCopy.SEPARATOR),
                maxLines = 2,
            )
        },
        label = { Text(direction.lineName) },
    )
}

/** Nothing saved on the phone yet, or nothing sent: the stations are pinned there. */
@Composable
private fun NoStations(phone: PhoneLink) {
    val scope = rememberCoroutineScope()
    val listState = rememberScalingLazyListState()
    ScreenScaffold(
        scrollState = listState,
        edgeButton = {
            EdgeButton(onClick = { scope.launch { phone.openApp() } }) { Text(stringResource(R.string.idle_open_phone)) }
        },
    ) { padding ->
        ScalingLazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
            item {
                Text(
                    stringResource(R.string.config_empty_title),
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = INSET),
                )
            }
            item {
                Text(
                    stringResource(R.string.config_empty_detail),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = INSET),
                )
            }
        }
    }
}

private val DOT = 12.dp
private val INSET = 12.dp
private val PLATFORM_SLASH = Regex("\\s*/\\s*")
