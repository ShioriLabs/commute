package id.shiorilabs.commute.feature.map.presentation

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.feature.map.R

/**
 * "Jenis peta", as Google Maps' layers card: the FDTJ artwork or the streets, each a thumbnail
 * outlined when it's the one shown.
 */
@Composable
internal fun LayerPicker(
    streets: Boolean,
    onPick: (streets: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.map_layers_title)
    Surface(
        modifier = modifier.width(LAYER_CARD_WIDTH).semantics { paneTitle = title },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                LayerTile(
                    label = stringResource(R.string.map_layer_schematic),
                    image = R.drawable.map_layer_schematic,
                    picked = !streets,
                    onClick = { onPick(false) },
                )
                LayerTile(
                    label = stringResource(R.string.map_layer_streets),
                    image = R.drawable.map_layer_streets,
                    picked = streets,
                    onClick = { onPick(true) },
                )
            }
        }
    }
}

@Composable
private fun LayerTile(label: String, @DrawableRes image: Int, picked: Boolean, onClick: () -> Unit) {
    val accent = MaterialTheme.colorScheme.primary
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.RadioButton, onClick = onClick)
            .semantics { selected = picked }
            .padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Image(
            painter = painterResource(image),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(LAYER_THUMB)
                .clip(RoundedCornerShape(12.dp))
                .border(
                    if (picked) BorderStroke(2.5.dp, accent) else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    RoundedCornerShape(12.dp),
                ),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (picked) FontWeight.Bold else FontWeight.Medium,
            color = if (picked) accent else MaterialTheme.colorScheme.onSurface,
        )
    }
}

private val LAYER_CARD_WIDTH = 236.dp
private val LAYER_THUMB = 88.dp
