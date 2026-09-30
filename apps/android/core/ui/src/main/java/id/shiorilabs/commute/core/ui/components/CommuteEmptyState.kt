package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Side of the square the illustration is fitted into, matching the web's empty states. */
private val IllustrationSize = 192.dp

/**
 * The app-wide "there's nothing here" state: an [illustration], then [title], then [body] — stacked
 * in a centered column, in that order.
 *
 * The column sizes itself to its content — the caller supplies the surrounding box through
 * [modifier] (`fillMaxSize()` for a screen-level state).
 *
 * [body] is an [AnnotatedString] so copy can point at a control by name in bold.
 *
 * @param illustrationDescription what the illustration shows, for screen readers.
 */
@Composable
fun CommuteEmptyState(
    illustration: Painter,
    illustrationDescription: String,
    title: String,
    body: AnnotatedString,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painter = illustration,
            contentDescription = illustrationDescription,
            modifier = Modifier.size(IllustrationSize),
            contentScale = ContentScale.Fit,
        )
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = TextAlign.Center,
        )
        VerticalSpacer(8.dp)
        Text(
            text = body,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = TextAlign.Center,
        )
    }
}
