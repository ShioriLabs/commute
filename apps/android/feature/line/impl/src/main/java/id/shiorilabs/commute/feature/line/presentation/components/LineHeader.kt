package id.shiorilabs.commute.feature.line.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.ui.components.CommuteCloseButton
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.components.SkeletonBlock
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.line.R
import id.shiorilabs.commute.feature.line.domain.LineDetail

/** The operator under the name, the web's `text-slate-500`. */
private val OperatorColor = Color(0xFF64748B)

/**
 * The page's header, as the web's line page draws it: the line's roundel, its name over its
 * operator, and the close button. While the line loads, the name and colour its opener passed
 * ([placeholderTitle], [placeholderColor]) stand in, or a skeleton without them; once it has
 * failed, only the close button is left.
 *
 * [topInset] is the status bar's height, carried inside the header so the frost reaches up behind
 * the clock.
 */
@Composable
fun LineHeader(
    line: UIState<LineDetail>,
    operator: String,
    lineCode: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    placeholderTitle: String? = null,
    placeholderColor: String? = null,
    topInset: Dp = 0.dp,
) {
    val loaded = (line as? UIState.Success)?.data
    val placeholder = line !is UIState.Error
    val title = loaded?.name ?: placeholderTitle?.takeIf { placeholder }
    val color = loaded?.colorCode ?: placeholderColor?.takeIf { placeholder }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = topInset)
            // The web's p-8 pb-4, as on the station page.
            .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (title != null && color != null) {
            LineRoundel(code = lineCode, color = color, operator = operator, size = RoundelSize.MD)
        } else if (placeholder) {
            SkeletonBlock(modifier = Modifier.size(36.dp), shape = CircleShape)
        }
        Column(modifier = Modifier.weight(1f)) {
            if (title != null) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = loaded?.operatorName ?: OPERATOR_NAMES[operator] ?: operator,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = OperatorColor,
                )
            } else if (placeholder) {
                SkeletonBlock(
                    modifier = Modifier
                        .width(192.dp)
                        .height(24.dp),
                    shape = MaterialTheme.shapes.small,
                )
            }
        }
        CommuteCloseButton(
            onClick = onClose,
            contentDescription = stringResource(R.string.line_close_description),
            tint = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LineHeaderPreview() {
    CommutePreviewScaffold {
        LineHeader(
            line = UIState.Loading,
            operator = "KCI",
            lineCode = "B",
            onClose = {},
            placeholderTitle = "Lin Bogor",
            placeholderColor = "#EE3D43",
        )
    }
}
