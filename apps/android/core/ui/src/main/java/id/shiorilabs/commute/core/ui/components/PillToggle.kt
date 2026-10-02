package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/** The track's `bg-stone-100/80` and `border-stone-200/40`, and an unselected option's `text-slate-500`. */
private val TrackFill = Color(0xCCF5F5F4)
private val TrackOutline = Color(0x66E7E5E4)
private val IdleText = Color(0xFF64748B)

/**
 * A few options in a pill, the chosen one filled in the brand colour: the web's search mode toggle,
 * as a component. [description] names the choice for accessibility services.
 */
@Composable
fun PillToggle(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    description: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(TrackFill)
            .border(2.dp, TrackOutline, CircleShape)
            .padding(4.dp)
            .selectableGroup()
            .semantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEachIndexed { index, option ->
            val isSelected = index == selected
            Text(
                text = option,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .selectable(selected = isSelected, role = Role.Tab) {
                        if (!isSelected) {
                            onSelect(index)
                        }
                    }
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = if (isSelected) MaterialTheme.colorScheme.onPrimary else IdleText,
            )
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFFFFFFF)
@Composable
private fun PillTogglePreview() {
    CommutePreviewScaffold {
        PillToggle(options = listOf("Satu stasiun", "OTW"), selected = 1, onSelect = {}, description = "Mode pencarian")
    }
}
