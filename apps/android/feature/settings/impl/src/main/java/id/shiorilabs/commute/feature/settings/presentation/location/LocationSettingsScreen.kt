package id.shiorilabs.commute.feature.settings.presentation.location

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.datastore.LocationUse
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsGutter
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsItem
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsSectionLabel

/**
 * What the app may use the rider's location for: one switch over all of it, and under it each use
 * on its own. These only narrow what the system's permission allows, so the page also says whether
 * that is granted, and opens the system's page for it.
 */
@Composable
fun LocationSettingsScreen(
    innerPadding: PaddingValues,
    viewModel: LocationSettingsViewModel = hiltViewModel(),
) {
    val use by viewModel.use.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    // Read again on coming back from the system's page, where the rider may have changed it.
    var permitted by remember { mutableStateOf(locationPermitted(context)) }
    LifecycleResumeEffect(context) {
        permitted = locationPermitted(context)
        onPauseOrDispose {}
    }

    LocationSettingsContent(
        use = use,
        permitted = permitted,
        innerPadding = innerPadding,
        onBack = { navigator.pop() },
        onEnabled = { viewModel.setEnabled(it) },
        onHomeNearby = { viewModel.setHomeNearby(it) },
        onPickerNearby = { viewModel.setPickerNearby(it) },
        onTripFixes = { viewModel.setTripFixes(it) },
        onOpenSystemSettings = {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        },
    )
}

@Composable
private fun LocationSettingsContent(
    use: LocationUse?,
    permitted: Boolean,
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
    onEnabled: (Boolean) -> Unit = {},
    onHomeNearby: (Boolean) -> Unit = {},
    onPickerNearby: (Boolean) -> Unit = {},
    onTripFixes: (Boolean) -> Unit = {},
    onOpenSystemSettings: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_location_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        Text(
            text = stringResource(R.string.settings_location_hint),
            modifier = Modifier.padding(start = SettingsGutter, end = SettingsGutter, bottom = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // Read off disk within a frame or two; nothing is drawn meanwhile, as on Atur Data.
        if (use == null) return@SettingsPage
        SwitchRow(
            title = stringResource(R.string.settings_location_enabled),
            subtitle = stringResource(R.string.settings_location_enabled_detail),
            checked = use.enabled,
            onCheckedChange = onEnabled,
        )
        SettingsSectionLabel(
            text = stringResource(R.string.settings_location_section_uses),
            modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
        )
        SwitchRow(
            title = stringResource(R.string.settings_location_home_nearby),
            subtitle = stringResource(R.string.settings_location_home_nearby_detail),
            checked = use.homeNearby,
            enabled = use.enabled,
            onCheckedChange = onHomeNearby,
        )
        SwitchRow(
            title = stringResource(R.string.settings_location_picker_nearby),
            subtitle = stringResource(R.string.settings_location_picker_nearby_detail),
            checked = use.pickerNearby,
            enabled = use.enabled,
            onCheckedChange = onPickerNearby,
        )
        SwitchRow(
            title = stringResource(R.string.settings_location_trip_fixes),
            subtitle = stringResource(R.string.settings_location_trip_fixes_detail),
            checked = use.tripFixes,
            enabled = use.enabled,
            onCheckedChange = onTripFixes,
        )
        SettingsItem(
            label = stringResource(R.string.settings_location_permission),
            detail = stringResource(if (permitted) R.string.settings_location_permission_granted else R.string.settings_location_permission_denied),
            external = true,
            onClick = onOpenSystemSettings,
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}

/**
 * A setting that is on or off: what it is and what it does, and the switch. The whole row toggles
 * it. With [enabled] false (the switch over it is off) it shows its own setting, greyed, kept for
 * when that comes back on.
 */
@Composable
private fun SwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            // Atur Data's rows: the web's px-8 py-4.
            .padding(horizontal = SettingsGutter, vertical = 16.dp)
            .alpha(if (enabled) 1f else 0.4f),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // The row is the control; the switch only shows it.
        Switch(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary),
        )
    }
}

private fun locationPermitted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

@Preview(showBackground = true)
@Composable
private fun LocationSettingsContentPreview() {
    CommutePreviewScaffold {
        LocationSettingsContent(use = LocationUse(tripFixes = false), permitted = true, innerPadding = PaddingValues())
    }
}
