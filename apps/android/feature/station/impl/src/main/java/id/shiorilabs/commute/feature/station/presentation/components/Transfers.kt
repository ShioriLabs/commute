package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.OPERATOR_TJ
import id.shiorilabs.commute.feature.station.domain.Transfer
import id.shiorilabs.commute.feature.station.domain.codeOfLineKey
import id.shiorilabs.commute.feature.station.domain.sortLineKeysForDisplay

private val Gray600 = Color(0xFF4B5563)

/** The "Integrasi" heading, over the rows [TransferRow] draws one per transfer. */
@Composable
fun TransfersHeading(modifier: Modifier = Modifier) {
    SectionHeading(stringResource(R.string.station_transfers_title), modifier)
}

/**
 * A station a rider can walk to from this one, as the web's Integrasi list draws it: its name with
 * the walk in metres, its operator, the lines it serves for one on this network, and directions for
 * the walk when there are any.
 *
 * Each roundel opens its line's page through [onOpenLine], as on the web, except a TransJakarta
 * corridor's: the web gives corridors no page.
 */
@Composable
fun TransferRow(
    transfer: Transfer,
    lines: Map<String, LineInfo>,
    modifier: Modifier = Modifier,
    onOpenLine: (lineKey: String) -> Unit = {},
) {
    val distanceDescription = stringResource(R.string.station_transfer_distance_description, transfer.distanceM)
    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = transfer.name,
                modifier = Modifier.weight(1f, fill = false),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Row(
                modifier = Modifier
                    .padding(start = 8.dp)
                    .semantics(mergeDescendants = true) { contentDescription = distanceDescription },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = CommuteIcons.Walk,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = Gray600,
                )
                Text(
                    text = stringResource(R.string.station_transfer_distance, transfer.distanceM),
                    modifier = Modifier.padding(start = 4.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Gray600,
                )
            }
        }
        Text(
            // An INTERNAL transfer names its operator by code; an EXTERNAL one only in plain text.
            text = when (transfer) {
                is Transfer.Internal -> OPERATOR_NAMES[transfer.operator] ?: transfer.operator
                is Transfer.External -> transfer.operatorName
            },
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = Gray600,
        )
        if (transfer is Transfer.Internal && transfer.lineKeys.isNotEmpty()) {
            FlowRow(
                modifier = Modifier.padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                sortLineKeysForDisplay(transfer.lineKeys, transfer.operator).forEach { key ->
                    val info = lines[key]
                    LineRoundel(
                        code = info?.lineCode ?: codeOfLineKey(key),
                        color = info?.colorCode ?: "#94A3B8",
                        operator = transfer.operator,
                        size = RoundelSize.SM,
                        modifier = Modifier
                            .then(
                                if (transfer.operator != OPERATOR_TJ) {
                                    Modifier.clickable(role = Role.Button) { onOpenLine(key) }
                                } else {
                                    Modifier
                                },
                            )
                            .semantics { contentDescription = info?.name ?: key },
                    )
                }
            }
        }
        transfer.notes?.let { notes ->
            Text(
                text = notes,
                modifier = Modifier.padding(top = 4.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = Gray600,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun TransferRowPreview() {
    CommutePreviewScaffold {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            TransfersHeading()
            TransferRow(
                transfer = Transfer.Internal(
                    id = "T-1",
                    distanceM = 300,
                    notes = "Keluar lewat pintu B, lalu jalan lewat terowongan penghubung",
                    stationId = "KCI-SUDB",
                    name = "BNI City",
                    operator = "KCI",
                    lineKeys = listOf("KCI:A", "KCI:C"),
                ),
                lines = mapOf("KCI:C" to LineInfo("Lin Cikarang", "C", "#25B8EB", "KCI")),
            )
            TransferRow(
                transfer = Transfer.External("T-2", 230, null, "Halim", "KCIC"),
                lines = emptyMap(),
            )
        }
    }
}
