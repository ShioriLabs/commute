package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.feature.search.domain.Searchable

/** Every rail line as a coloured chip, in one wrapping group. */
@Composable
fun LineChips(
    title: String,
    lines: List<Searchable.Line>,
    onClick: (Searchable.Line) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        SectionLabel(
            text = title,
            modifier = Modifier.padding(horizontal = 32.dp),
        )
        VerticalSpacer(8.dp)
        FlowRow(
            modifier = Modifier.padding(horizontal = 32.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            lines.forEach { line ->
                LinePill(
                    line = line.line,
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickable { onClick(line) },
                )
            }
        }
    }
}
