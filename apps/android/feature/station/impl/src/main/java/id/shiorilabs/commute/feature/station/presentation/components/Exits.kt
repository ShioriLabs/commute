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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.ExitBadge
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.Gray600
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.ExitSign
import id.shiorilabs.commute.feature.station.domain.SignKind
import id.shiorilabs.commute.feature.station.domain.StationExit

/**
 * The station's exits, each as the board prints it: the signed code in the Jak Lingko badge, then
 * the board's entries in their printed order. An entry that names a station or halte opens it. The
 * web's `StationExits`.
 *
 * Draws nothing for a station with no exits recorded, which is most of them: the list is backfilled
 * station by station, so an empty one is "not yet", and a section saying so would only advertise
 * the gap.
 */
@Composable
fun StationExits(
    exits: List<StationExit>,
    modifier: Modifier = Modifier,
    onOpenStation: (stationId: String) -> Unit = {},
    onOpenAttributions: () -> Unit = {},
) {
    if (exits.isEmpty()) {
        return
    }
    Column(modifier = modifier.fillMaxWidth()) {
        SectionHeading(stringResource(R.string.station_exits_title))
        Column(
            modifier = Modifier.padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            exits.forEach { exit -> ExitRow(exit, onOpenStation) }
        }
        // OpenStreetMap's data is ODbL: credited wherever it is shown.
        if (exits.any { it.fromOsm }) {
            Column(modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp)) {
                Text(
                    text = stringResource(R.string.station_exits_osm_note),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Gray600,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.station_exits_osm_copyright),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Gray600,
                    )
                    Text(
                        text = stringResource(R.string.station_exits_osm_link),
                        modifier = Modifier.clickable(role = Role.Button, onClick = onOpenAttributions),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ExitRow(exit: StationExit, onOpenStation: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ExitBadge(code = exit.ref, modifier = Modifier.padding(top = 2.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = exit.name ?: stringResource(R.string.station_exit_default_name, exit.ref),
                modifier = Modifier.padding(top = 2.dp),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            exit.signs.forEach { sign -> SignLine(sign, onOpenStation) }
        }
    }
}

/**
 * One entry of a board: its icon if the board gives it one, then its text. A station id is
 * `OPERATOR-CODE`, split at the first dash, which opens that station; the rest is plain text.
 */
@Composable
private fun SignLine(sign: ExitSign, onOpenStation: (String) -> Unit) {
    val target = sign.stationId?.takeIf { it.indexOf('-') > 0 }
    Row(
        modifier = if (target != null) Modifier.clickable(role = Role.Button) { onOpenStation(target) } else Modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (sign.kind) {
            SignKind.RAIL -> SignIcon(CommuteIcons.Train, target != null)
            SignKind.BUS -> SignIcon(CommuteIcons.Bus, target != null)
            null -> Unit
        }
        Text(
            text = sign.text,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (target != null) FontWeight.SemiBold else FontWeight.Normal,
            color = if (target != null) MaterialTheme.colorScheme.primary else Gray600,
        )
    }
}

@Composable
private fun SignIcon(icon: ImageVector, linked: Boolean) {
    Icon(
        imageVector = icon,
        contentDescription = null,
        modifier = Modifier.size(16.dp),
        tint = if (linked) MaterialTheme.colorScheme.primary else Gray600,
    )
}

@Preview(showBackground = true)
@Composable
private fun StationExitsPreview() {
    CommutePreviewScaffold {
        StationExits(
            exits = listOf(
                StationExit(
                    id = "MRTJ-IST:B",
                    ref = "B",
                    name = "Jl. Pintu Satu Senayan",
                    signs = listOf(
                        ExitSign("Jl. Pintu Satu Senayan", kind = null, stationId = null),
                        ExitSign("Stasiun Palmerah", kind = SignKind.RAIL, stationId = "KCI-PLM"),
                        ExitSign("Halte Gelora Bung Karno", kind = SignKind.BUS, stationId = "TJ-H00201P"),
                    ),
                    fromOsm = false,
                ),
                StationExit(id = "MRTJ-IST:Utara", ref = "Utara", name = null, signs = emptyList(), fromOsm = true),
            ),
        )
    }
}
