package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.components.CommuteBottomSheet
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R

/** One option in a [ChoiceSheet]: its value, its name, and what picking it means. */
internal data class Choice<T>(val value: T, val label: String, val description: String)

/** The settings list behind the criteria chip: every standing setting, one row each. */
@Composable
internal fun SettingsSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val title = stringResource(R.string.journey_settings)
    CommuteBottomSheet(
        title = title,
        closeDescription = stringResource(R.string.journey_sheet_close, title.lowercase()),
        onDismiss = onDismiss,
    ) {
        content()
    }
}

/** What a setting is and what it is set to; opens that setting's own sheet. */
@Composable
internal fun SettingRow(label: String, value: String, modified: Boolean, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button) {
                haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                onClick()
            }
            .padding(horizontal = 32.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label.uppercase(),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.5.sp,
                color = Slate400,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = if (modified) Pink800 else Slate900,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(16.dp), tint = Slate400)
    }
}

/**
 * One single-choice sheet for every setting: each option with what it means, the chosen one ticked.
 * Choosing closes it: a rider who has set what they came for is done.
 */
@Composable
internal fun <T> ChoiceSheet(
    title: String,
    options: List<Choice<T>>,
    selected: T,
    onSelect: (T) -> Unit,
    onDismiss: () -> Unit,
    icon: (@Composable (T) -> Unit)? = null,
) {
    val haptics = LocalHapticFeedback.current
    CommuteBottomSheet(
        title = title,
        closeDescription = stringResource(R.string.journey_sheet_close, title.lowercase()),
        onDismiss = onDismiss,
    ) { hide ->
        Column(modifier = Modifier.padding(bottom = 32.dp).selectableGroup()) {
            options.forEach { option ->
                val isSelected = option.value == selected
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(if (isSelected) Rose50 else Color.Transparent)
                        .selectable(selected = isSelected, role = Role.RadioButton) {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onSelect(option.value)
                            hide()
                        }
                        .padding(horizontal = 32.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    icon?.invoke(option.value)
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(text = option.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(text = option.description, style = MaterialTheme.typography.bodyMedium, color = Slate500)
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
