package id.shiorilabs.commute.feature.saved.presentation.nearby

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.location.rememberLocationPermissionRequest
import id.shiorilabs.commute.core.ui.components.CommuteIconButton
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.saved.R

private val PromptFill = Color(0xFFF1F5F9)
private val Slate400 = Color(0xFF94A3B8)
private val Slate500 = Color(0xFF64748B)

/**
 * The offer to show stations near the rider, in place of the section while location isn't granted.
 * The permission is asked for on the tap, never by home on its own; closing it is remembered.
 */
@Composable
internal fun NearbyPromptCard(onResult: (Boolean) -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val ask = rememberLocationPermissionRequest(onResult)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(PromptFill)
            .clickable(role = Role.Button, onClick = ask)
            .padding(start = 16.dp, top = 16.dp, bottom = 16.dp, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = CommuteIcons.NavigationArrow,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.saved_nearby_prompt_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = stringResource(R.string.saved_nearby_prompt_body),
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )
        }
        CommuteIconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
            Icon(
                imageVector = CommuteIcons.Close,
                contentDescription = stringResource(R.string.saved_nearby_prompt_dismiss),
                modifier = Modifier.size(18.dp),
                tint = Slate400,
            )
        }
    }
}

/** "DI DEKAT KAMU", over the nearby stations, set like the picker's section labels. */
@Composable
internal fun NearbyHeading(modifier: Modifier = Modifier) {
    Text(
        text = stringResource(R.string.saved_nearby_title).uppercase(),
        modifier = modifier.padding(horizontal = 32.dp),
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.5.sp,
        color = Slate400,
    )
}

/** `350 m`, or `1,2 km` past a kilometre. */
internal fun formatDistance(metres: Int): String =
    if (metres < 1000) "$metres m" else "%.1f km".format(java.util.Locale.forLanguageTag("id"), metres / 1000.0)
