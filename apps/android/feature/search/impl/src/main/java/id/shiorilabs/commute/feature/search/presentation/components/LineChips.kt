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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.search.domain.SearchLine
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
            // Chips are containers: edge on the 16dp gutter, as the header's field and toggle.
            modifier = Modifier.padding(horizontal = 16.dp),
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

@Preview(showBackground = true)
@Composable
private fun LineChipsPreview() {
    val lines = listOf(
        "Lin Bogor" to "#EE3D43",
        "Lin Cikarang" to "#25B8EB",
        "Lin Rangkasbitung" to "#7BC043",
        "Lin Tanjung Priok" to "#E5A5C8",
        "Lin Lingkar Cikarang" to "#F7941D",
    ).map { (name, color) ->
        Searchable.Line(
            title = name,
            to = "/lines/KCI/$name",
            keywords = emptyList(),
            subtitle = null,
            score = null,
            operator = "KCI",
            line = SearchLine(name, name.takeLast(1), color, "KCI"),
        )
    }
    CommutePreviewScaffold {
        LineChips(title = "Semua lin", lines = lines, onClick = {}, modifier = Modifier.padding(vertical = 16.dp))
    }
}
