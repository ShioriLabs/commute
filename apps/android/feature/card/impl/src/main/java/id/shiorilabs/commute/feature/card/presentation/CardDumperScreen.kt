package id.shiorilabs.commute.feature.card.presentation

import android.content.Context
import android.content.Intent
import android.nfc.NfcAdapter
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.card.R
import id.shiorilabs.commute.feature.card.dump.CardDump
import id.shiorilabs.commute.feature.card.felica.DumpProgress
import id.shiorilabs.commute.feature.card.felica.findActivity
import id.shiorilabs.commute.feature.card.felica.readAnyCard
import id.shiorilabs.commute.feature.card.iso.IsoDumper

/** The settings pages' p-8, so the dumper lines up with Experimental, where it's opened from. */
private val Gutter = 32.dp

/**
 * Reads a card held to the phone and keeps what it shows: a FeliCa card in full, an NFC-A or NFC-B
 * one as far as [IsoDumper] goes. Reader mode is on only while this screen is resumed, so a card
 * tapped anywhere else in the app is left alone.
 */
@Composable
fun CardDumperScreen(
    innerPadding: PaddingValues,
    viewModel: CardDumperViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val adapter = remember(context) { NfcAdapter.getDefaultAdapter(context) }
    var nfcOn by remember { mutableStateOf(adapter?.isEnabled == true) }
    val empty = stringResource(R.string.card_dumper_share_empty)

    LifecycleResumeEffect(adapter) {
        nfcOn = adapter?.isEnabled == true
        val activity = context.findActivity()
        if (adapter != null && activity != null && nfcOn) adapter.readAnyCard(activity, viewModel::read, viewModel::identify)
        onPauseOrDispose {
            if (adapter != null && activity != null) runCatching { adapter.disableReaderMode(activity) }
        }
    }

    CardDumperContent(
        innerPadding = innerPadding,
        nfc = when {
            adapter == null -> Nfc.Missing
            !nfcOn -> Nfc.Off
            else -> Nfc.On
        },
        state = state,
        onBack = { navigator.pop() },
        onNfcSettings = { context.startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) },
        onSave = viewModel::save,
        onAgain = viewModel::again,
        onShare = {
            viewModel.share { intent ->
                if (intent != null) context.startActivity(intent) else Toast.makeText(context, empty, Toast.LENGTH_SHORT).show()
            }
        },
        onClear = { viewModel.clear() },
    )
}

private enum class Nfc { Missing, Off, On }

@Composable
private fun CardDumperContent(
    innerPadding: PaddingValues,
    nfc: Nfc,
    state: CardDumperUiState,
    onBack: () -> Unit = {},
    onNfcSettings: () -> Unit = {},
    onSave: (String) -> Unit = {},
    onAgain: () -> Unit = {},
    onShare: () -> Unit = {},
    onClear: () -> Unit = {},
) {
    var confirmingClear by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .padding(top = innerPadding.calculateTopPadding()),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = Gutter - 8.dp, top = Gutter, end = Gutter, bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CommuteIconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
                Icon(
                    imageVector = CommuteIcons.Back,
                    contentDescription = stringResource(R.string.card_dumper_back),
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
            Text(
                text = stringResource(R.string.card_dumper_title),
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Gutter),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when {
                nfc == Nfc.Missing -> Hint(stringResource(R.string.card_dumper_no_nfc))
                nfc == Nfc.Off -> {
                    Hint(stringResource(R.string.card_dumper_nfc_off))
                    CommuteButton(text = stringResource(R.string.card_dumper_nfc_settings), onClick = onNfcSettings)
                }
                state.phase == CardDumperUiState.Phase.Waiting -> Hint(stringResource(R.string.card_dumper_waiting))
                state.phase == CardDumperUiState.Phase.Reading -> Reading(state.progress)
                state.dump != null -> Done(state.dump, state.savedAs, onSave, onAgain)
            }

            Spacer(Modifier.height(8.dp))
            Hint(stringResource(R.string.card_dumper_saved_count, state.savedCount))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CommuteButton(text = stringResource(R.string.card_dumper_share), onClick = onShare, variant = CommuteButtonVariant.Secondary)
                CommuteButton(
                    text = stringResource(R.string.card_dumper_clear),
                    onClick = { confirmingClear = true },
                    variant = CommuteButtonVariant.Secondary,
                    enabled = state.savedCount > 0,
                )
            }
            Hint(stringResource(R.string.card_dumper_privacy))
            Spacer(Modifier.height(16.dp + innerPadding.calculateBottomPadding()))
        }
    }

    if (confirmingClear) {
        AlertDialog(
            onDismissRequest = { confirmingClear = false },
            text = { Text(stringResource(R.string.card_dumper_clear_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingClear = false
                    onClear()
                }) { Text(stringResource(R.string.card_dumper_clear_yes)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingClear = false }) { Text(stringResource(R.string.card_dumper_clear_no)) }
            },
        )
    }
}

@Composable
private fun Reading(progress: DumpProgress?) {
    Hint(stringResource(R.string.card_dumper_reading))
    val step = when (progress?.step) {
        DumpProgress.Step.Searching -> R.string.card_dumper_step_searching
        DumpProgress.Step.Reading -> R.string.card_dumper_step_reading
        DumpProgress.Step.Mapping -> R.string.card_dumper_step_mapping
        else -> R.string.card_dumper_step_systems
    }
    Text(stringResource(step), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
    if (progress != null && progress.total > 0) {
        LinearProgressIndicator(progress = { progress.done.toFloat() / progress.total }, modifier = Modifier.fillMaxWidth())
        Hint(stringResource(R.string.card_dumper_found, progress.services, progress.blocks))
    } else {
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Done(dump: CardDump, savedAs: String?, onSave: (String) -> Unit, onAgain: () -> Unit) {
    var note by rememberSaveable(dump.transcript.size, dump.tag?.idm ?: dump.iso?.id) { mutableStateOf("") }
    Text(
        text = if (dump.complete) stringResource(R.string.card_dumper_complete) else stringResource(R.string.card_dumper_partial, dump.failure.orEmpty()),
        style = MaterialTheme.typography.titleMedium,
        color = if (dump.complete) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.error,
    )
    for (system in dump.systems) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = stringResource(R.string.card_dumper_summary_system, system.code, system.idm ?: "—"),
                style = MaterialTheme.typography.titleSmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onBackground,
            )
            for (service in system.services) {
                Text(
                    text = if (service.readable) {
                        stringResource(R.string.card_dumper_summary_service, service.code, service.blocks.size)
                    } else {
                        stringResource(R.string.card_dumper_summary_keyed, service.code)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    color = if (service.readable) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    dump.iso?.let { iso ->
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Hint(stringResource(R.string.card_dumper_iso_hint))
            val lines = listOfNotNull(
                iso.techs.joinToString(" · "),
                "ID ${iso.id}",
                iso.atqa?.let { "ATQA $it · SAK ${iso.sak}" },
                iso.historicalBytes?.let { "Historical $it" },
                iso.applicationData?.let { "App data $it · protocol ${iso.protocolInfo}" },
                iso.hiLayerResponse?.let { "Hi-layer $it" },
                iso.pse?.let { "PSE ${it.status} · ${it.records.size} record" },
            )
            for (line in lines) {
                Text(line, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onBackground)
            }
        }
    }
    OutlinedTextField(
        value = note,
        onValueChange = { note = it },
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.card_dumper_note)) },
        enabled = savedAs == null,
    )
    if (!savedAs.isNullOrEmpty()) Hint(stringResource(R.string.card_dumper_saved, savedAs))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        CommuteButton(text = stringResource(R.string.card_dumper_save), onClick = { onSave(note) }, enabled = savedAs == null)
        CommuteButton(text = stringResource(R.string.card_dumper_again), onClick = onAgain, variant = CommuteButtonVariant.Secondary)
    }
}

@Composable
private fun Hint(text: String) {
    Text(text = text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Preview
@Composable
private fun CardDumperReadingPreview() {
    CommutePreviewScaffold {
        CardDumperContent(
            innerPadding = PaddingValues(),
            nfc = Nfc.On,
            state = CardDumperUiState(
                phase = CardDumperUiState.Phase.Reading,
                progress = DumpProgress(DumpProgress.Step.Searching, done = 96, total = 256, services = 3, blocks = 0),
                savedCount = 2,
            ),
        )
    }
}

@Preview
@Composable
private fun CardDumperDonePreview() {
    val dump = CardDump(
        tag = CardDump.Tag(idm = "012E3456789ABCDE", pmm = "100B4B428485D0FF", systemCode = "0003"),
        systems = listOf(
            CardDump.SystemDump(
                code = "0003",
                idm = "012E3456789ABCDE",
                pmm = "100B4B428485D0FF",
                services = listOf(
                    CardDump.ServiceDump(code = "090F", keyVersion = "0001", readable = true, blocks = List(20) { "00".repeat(16) }, stop = "01A8"),
                    CardDump.ServiceDump(code = "1810", keyVersion = "0203", readable = false),
                ),
            ),
        ),
        probes = emptyList(),
        complete = true,
        transcript = emptyList(),
    )
    CommutePreviewScaffold {
        CardDumperContent(
            innerPadding = PaddingValues(),
            nfc = Nfc.On,
            state = CardDumperUiState(phase = CardDumperUiState.Phase.Done, dump = dump, savedCount = 2),
        )
    }
}
