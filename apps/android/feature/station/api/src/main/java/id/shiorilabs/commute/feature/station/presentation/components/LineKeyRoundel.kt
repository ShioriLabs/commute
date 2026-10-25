package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey

/**
 * Line [lineKey]'s roundel (`KCI:C`), as [info] from the line dictionary has it; a line it doesn't
 * have (yet) shows its code from the key, in slate, the colour `lineColorOf` falls back to.
 */
@Composable
fun LineRoundel(
    lineKey: String,
    info: LineInfo?,
    modifier: Modifier = Modifier,
    operator: String? = info?.operator ?: lineKey.substringBefore(':', "").ifEmpty { null },
    size: RoundelSize = RoundelSize.MD,
) {
    LineRoundel(
        code = info?.lineCode ?: codeOfLineKey(lineKey),
        color = info?.colorCode ?: UNKNOWN_LINE_COLOR,
        modifier = modifier,
        operator = operator,
        size = size,
    )
}

/** Slate 400. */
private const val UNKNOWN_LINE_COLOR = "#94A3B8"
