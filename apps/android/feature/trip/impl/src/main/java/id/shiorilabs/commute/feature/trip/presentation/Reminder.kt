package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Rose50
import id.shiorilabs.commute.core.ui.theme.Slate500
import id.shiorilabs.commute.core.ui.theme.Slate900
import id.shiorilabs.commute.feature.trip.R
import id.shiorilabs.commute.feature.trip.TripReminder

/**
 * "Tambah Pengingat" under the trip's actions, or the reminder already set; either opens the sheet
 * to choose one.
 */
@Composable
internal fun ReminderButton(reminder: TripReminder, onChange: (TripReminder) -> Unit, modifier: Modifier = Modifier) {
    var choosing by rememberSaveable { mutableStateOf(false) }
    val set = reminder != TripReminder.NONE
    CommuteButton(
        text = if (set) stringResource(R.string.trip_reminder_set, stringResource(reminder.label)) else stringResource(R.string.trip_reminder_add),
        onClick = { choosing = true },
        modifier = modifier.fillMaxWidth(),
        variant = CommuteButtonVariant.Secondary,
        leadingIcon = if (set) reminder.icon else CommuteIcons.Reminder,
    )
    if (choosing) {
        ReminderSheet(selected = reminder, onSelect = onChange, onDismiss = { choosing = false })
    }
}

/**
 * The reminders to choose from, each with what it does; the chosen one ticked. Choosing closes it,
 * as the criteria sheets do.
 */
@Composable
private fun ReminderSheet(selected: TripReminder, onSelect: (TripReminder) -> Unit, onDismiss: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val title = stringResource(R.string.trip_reminder_title)
    CommuteBottomSheet(
        title = title,
        closeDescription = stringResource(R.string.trip_reminder_close),
        onDismiss = onDismiss,
    ) { hide ->
        Column(modifier = Modifier.padding(bottom = 32.dp).selectableGroup()) {
            REMINDERS.forEach { reminder ->
                val isSelected = reminder == selected
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(if (isSelected) Rose50 else Color.Transparent)
                        .selectable(selected = isSelected, role = Role.RadioButton) {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onSelect(reminder)
                            hide()
                        }
                        .padding(horizontal = 32.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = reminder.icon,
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = if (isSelected) MaterialTheme.colorScheme.primary else Slate500,
                    )
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(text = stringResource(reminder.label), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Slate900)
                        Text(text = stringResource(reminder.description), style = MaterialTheme.typography.bodyMedium, color = Slate500)
                    }
                    if (isSelected) {
                        Icon(
                            imageVector = CommuteIcons.Selected,
                            contentDescription = null,
                            modifier = Modifier.size(24.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}

/** The two reminders first, as what the sheet's for, and none last. */
private val REMINDERS = listOf(TripReminder.PING, TripReminder.WAKE, TripReminder.NONE)

private val TripReminder.label: Int get() = when (this) {
    TripReminder.PING -> R.string.trip_reminder_ping
    TripReminder.WAKE -> R.string.trip_reminder_wake
    TripReminder.NONE -> R.string.trip_reminder_none
}

private val TripReminder.description: Int get() = when (this) {
    TripReminder.PING -> R.string.trip_reminder_ping_detail
    TripReminder.WAKE -> R.string.trip_reminder_wake_detail
    TripReminder.NONE -> R.string.trip_reminder_none_detail
}

private val TripReminder.icon: ImageVector get() = when (this) {
    TripReminder.PING -> CommuteIcons.ReminderPing
    TripReminder.WAKE -> CommuteIcons.ReminderWake
    TripReminder.NONE -> CommuteIcons.ReminderNone
}
