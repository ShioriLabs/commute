package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.saved.R
import id.shiorilabs.commute.feature.saved.presentation.RefreshNotice
import kotlinx.coroutines.delay

/** How long a refresh's notice stays up. */
private const val NOTICE_MILLIS = 2500L

private val PillShape = RoundedCornerShape(percent = 50)

/** Tailwind's emerald-400 and amber-400: legible on the slate pill. */
private val DoneTint = Color(0xFF34D399)
private val FailedTint = Color(0xFFFBBF24)

/**
 * Shows what a pull to refresh found for a moment, then hides it. [onShown] is called once it has
 * gone, so the notice isn't shown again; a new pull (the notice going back to null) hides it at
 * once.
 */
@Composable
internal fun RefreshNoticeHost(
    notice: RefreshNotice?,
    onShown: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // The last notice, kept through the exit animation after the state has let it go.
    var shown by remember { mutableStateOf<RefreshNotice?>(null) }
    var visible by remember { mutableStateOf(false) }
    val currentOnShown by rememberUpdatedState(onShown)
    LaunchedEffect(notice) {
        if (notice == null) {
            visible = false
            return@LaunchedEffect
        }
        shown = notice
        visible = true
        delay(NOTICE_MILLIS)
        visible = false
        currentOnShown()
    }
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn() + slideInVertically { -it / 2 },
        exit = fadeOut() + slideOutVertically { -it / 2 },
    ) {
        shown?.let { RefreshNoticePill(it) }
    }
}

/** A slate pill under the bar: a check and what changed, or a warning that it couldn't refresh. */
@Composable
internal fun RefreshNoticePill(
    notice: RefreshNotice,
    modifier: Modifier = Modifier,
) {
    val failed = notice is RefreshNotice.Failed
    Row(
        modifier = modifier
            .shadow(6.dp, PillShape)
            .background(MaterialTheme.colorScheme.inverseSurface, PillShape)
            .padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (failed) CommuteIcons.Warning else CommuteIcons.Check,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = if (failed) FailedTint else DoneTint,
        )
        Text(
            text = when (notice) {
                RefreshNotice.UpToDate -> stringResource(R.string.saved_refresh_up_to_date)
                is RefreshNotice.Updated -> stringResource(R.string.saved_refresh_updated, notice.count)
                is RefreshNotice.Failed -> stringResource(
                    if (notice.all) R.string.saved_refresh_failed_all else R.string.saved_refresh_failed_some,
                )
            },
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.inverseOnSurface,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun RefreshNoticePillPreview() {
    CommutePreviewScaffold {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RefreshNoticePill(RefreshNotice.UpToDate)
            RefreshNoticePill(RefreshNotice.Updated(2))
            RefreshNoticePill(RefreshNotice.Failed(all = false))
        }
    }
}
