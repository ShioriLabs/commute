package id.shiorilabs.commute.core.ui.debug

import android.content.ClipData
import android.util.Log
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.frost.FrostTuning
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import kotlinx.coroutines.launch

/**
 * Debug-only live tuner for the frost behind pinned headers: a small button that opens a floating
 * panel of sliders bound to [tuning]. Not a modal sheet: a scrim would dim the very headers being
 * judged. "Copy" puts the values on the clipboard and in logcat (tag `FrostTuning`), to bake back
 * into [FrostTuning]'s defaults. After midori's.
 *
 * Place it last in the app's root `Box`, and only in debug builds.
 */
@Composable
fun BoxScope.FrostTunerOverlay(
    tuning: FrostTuning,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()

    Column(
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
            .align(Alignment.CenterEnd)
            .padding(12.dp),
    ) {
        if (open) {
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.94f),
                tonalElevation = 6.dp,
                shadowElevation = 6.dp,
                modifier = Modifier.fillMaxWidth(0.86f),
            ) {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(12.dp),
                ) {
                    Text(
                        text = "Frost tuner",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    )
                    TunerSlider("Blur radius", "${tuning.blurRadius.value.toInt()}dp", tuning.blurRadius.value, 0f..64f) {
                        tuning.blurRadius = it.toInt().dp
                    }
                    TunerSlider("Tint alpha", "%.2f".format(tuning.tintAlpha), tuning.tintAlpha, 0f..1f) {
                        tuning.tintAlpha = it
                    }
                    TunerSlider("Grain", "%.2f".format(tuning.noiseFactor), tuning.noiseFactor, 0f..0.5f) {
                        tuning.noiseFactor = it
                    }
                    TunerSwitch("Force blur (ignore the RAM floor)", tuning.forceBlur) {
                        tuning.forceBlur = it
                    }
                    TunerSwitch("Page colour under content", tuning.backgroundFill) {
                        tuning.backgroundFill = it
                    }
                    TunerSwitch("Adaptive input scale", tuning.adaptiveQuality) {
                        tuning.adaptiveQuality = it
                    }
                    if (!tuning.adaptiveQuality) {
                        TunerSlider("Input quality", "%.2f".format(tuning.quality), tuning.quality, 0f..1f) {
                            tuning.quality = it
                        }
                    }
                    TunerSlider(
                        "Fade start (+ higher)",
                        "${tuning.featherShift.value.toInt()}dp",
                        tuning.featherShift.value,
                        -32f..32f,
                    ) {
                        tuning.featherShift = it.toInt().dp
                    }
                    TunerSlider("Fade length", "×%.2f".format(tuning.featherScale), tuning.featherScale, 0.25f..2.5f) {
                        tuning.featherScale = it
                    }
                    Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = tuning::reset) {
                            Text("Reset")
                        }
                        TextButton(
                            onClick = {
                                val values = tuning.describe()
                                Log.i("FrostTuning", values)
                                scope.launch {
                                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("FrostTuning", values)))
                                }
                            },
                        ) {
                            Text("Copy")
                        }
                    }
                }
            }
        }
        SmallFloatingActionButton(onClick = { open = !open }) {
            Icon(
                imageVector = if (open) CommuteIcons.Close else CommuteIcons.Tune,
                contentDescription = "Frost tuner",
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun TunerSlider(
    label: String,
    value: String,
    current: Float,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit,
) {
    Column(modifier = Modifier.padding(top = 8.dp)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
            Text(value, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
        }
        Slider(value = current.coerceIn(range), onValueChange = onChange, valueRange = range)
    }
}

@Composable
private fun TunerSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
