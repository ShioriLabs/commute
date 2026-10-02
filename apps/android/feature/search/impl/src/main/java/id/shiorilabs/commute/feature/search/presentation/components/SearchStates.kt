package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteEmptyState
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.feature.search.R

/** Placeholder blocks, the web's `bg-slate-200`. */
private val SkeletonColor = Color(0xFFE2E8F0)

/** Three placeholder rows while the index loads under a query. */
@Composable
fun SearchResultsSkeleton(modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        listOf(96.dp, 192.dp, 128.dp).forEach { titleWidth ->
            Column(Modifier.padding(horizontal = 32.dp, vertical = 16.dp)) {
                SkeletonBlock(width = titleWidth, height = 16.dp)
                VerticalSpacer(8.dp)
                SkeletonBlock(width = 48.dp, height = 12.dp)
            }
        }
    }
}

@Composable
private fun SkeletonBlock(width: Dp, height: Dp) {
    Box(
        Modifier
            .width(width)
            .height(height)
            .background(SkeletonColor, MaterialTheme.shapes.extraSmall),
    )
}

/** No station matched the query. */
@Composable
fun SearchNotFound(modifier: Modifier = Modifier) {
    CommuteEmptyState(
        illustration = painterResource(R.drawable.img_search_empty),
        illustrationDescription = stringResource(R.string.search_not_found_illustration_description),
        title = stringResource(R.string.search_not_found_title),
        body = AnnotatedString(stringResource(R.string.search_not_found_body)),
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 32.dp),
    )
}

/** The index failed to load. */
@Composable
fun SearchError(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 16.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerLow, MaterialTheme.shapes.medium)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        CommuteButton(
            text = stringResource(R.string.search_retry),
            onClick = onRetry,
        )
    }
}
