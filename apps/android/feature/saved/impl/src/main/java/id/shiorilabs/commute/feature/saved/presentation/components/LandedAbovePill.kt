package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

private val PillShape = RoundedCornerShape(percent = 50)

/**
 * Rises over the rail when what a late fix found has landed above the feed, out of sight: the way up
 * to it, within a thumb's reach, for a list that holds still until asked. A long name wraps rather
 * than cuts, as it may be a sponsor's.
 */
@Composable
internal fun LandedAbovePill(
    visible: Boolean,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn() + slideInVertically { it / 2 },
        exit = fadeOut() + slideOutVertically { it / 2 },
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .shadow(6.dp, PillShape)
                .clip(PillShape)
                .background(MaterialTheme.colorScheme.inverseSurface)
                .clickable(onClick = onClick)
                .padding(start = 12.dp, end = 16.dp, top = 10.dp, bottom = 10.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = CommuteIcons.MoveUp,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.inverseOnSurface,
            )
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.inverseOnSurface,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun LandedAbovePillPreview() {
    CommutePreviewScaffold {
        Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            LandedAbovePill(visible = true, label = "Di dekat kamu", onClick = {})
            LandedAbovePill(visible = true, label = "Cakung → Sudirman", onClick = {})
        }
    }
}
