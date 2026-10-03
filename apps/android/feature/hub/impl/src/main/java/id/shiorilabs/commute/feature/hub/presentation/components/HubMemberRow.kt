package id.shiorilabs.commute.feature.hub.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.hub.R
import id.shiorilabs.commute.feature.hub.domain.HubMember
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.sortLineKeysForDisplay

/** The operator beside the name, the web's `text-slate-500`. */
private val OperatorColor = Color(0xFF64748B)

/** The rule between rows, the web's `border-stone-100`. */
private val RowDivider = Color(0xFFF5F5F4)

/** The chevron, the web's `text-slate-400`. */
private val ChevronColor = Color(0xFF94A3B8)

/**
 * One station in a hub, as the web's hub page lists it: its name with its operator beside it, the
 * roundels of the lines that call there underneath, and a chevron, since the row opens the
 * station's page.
 */
@Composable
fun HubMemberRow(
    member: HubMember,
    lines: Map<String, LineInfo>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    showDivider: Boolean = true,
) {
    val operatorName = OPERATOR_NAMES[member.operator] ?: member.operator
    // Until the dictionary loads there is nothing to draw a roundel with.
    val resolved = sortLineKeysForDisplay(member.lineKeys, member.operator).mapNotNull { lines[it] }
    val linesDescription = resolved.takeIf { it.isNotEmpty() }?.let { lineInfos ->
        stringResource(R.string.hub_member_lines_description, lineInfos.joinToString { it.name })
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .semantics(mergeDescendants = true) {
                    linesDescription?.let { contentDescription = "${member.name}, $operatorName, $it" }
                }
                // The web's px-8 py-4.
                .padding(horizontal = 32.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(member.name) }
                        // Two non-breaking spaces, as the web sets them, so the operator never
                        // starts a line on its own gap.
                        append("  ")
                        withStyle(
                            SpanStyle(
                                fontWeight = FontWeight.SemiBold,
                                color = OperatorColor,
                                fontSize = MaterialTheme.typography.bodySmall.fontSize,
                            ),
                        ) { append(operatorName) }
                    },
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                if (resolved.isNotEmpty()) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        resolved.forEach { line ->
                            LineRoundel(
                                code = line.lineCode,
                                color = line.colorCode,
                                operator = line.operator,
                                size = RoundelSize.SM,
                            )
                        }
                    }
                }
            }
            Icon(
                imageVector = CommuteIcons.Chevron,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = ChevronColor,
            )
        }
        if (showDivider) {
            HorizontalDivider(thickness = 1.dp, color = RowDivider)
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun HubMemberRowPreview() {
    CommutePreviewScaffold {
        HubMemberRow(
            member = HubMember("KCI-SUDB", "BNI City", "KCI", listOf("KCI:A", "KCI:C")),
            lines = mapOf(
                "KCI:A" to LineInfo("Lin Soekarno-Hatta", "A", "#262262", "KCI"),
                "KCI:C" to LineInfo("Lin Cikarang", "C", "#25B8EB", "KCI"),
            ),
            onClick = {},
        )
    }
}
