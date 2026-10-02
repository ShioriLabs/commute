package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/*
 * Material's buttons draw their own ripple rather than the theme's indication, so they can't take
 * the app's press feedback. These stand in for the two kinds the app uses, built on `clickable`,
 * which does.
 */

/**
 * A bare icon button, Material's `IconButton` without the ripple: [modifier] sets its visual size,
 * and the touch target still grows to the accessible minimum around it.
 */
@Composable
fun CommuteIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

/** A filled button in the brand colour, Material's `Button` as the app themes it. */
@Composable
fun CommuteButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // The touch target grows to the accessible minimum; the filled part keeps Material's size.
    Box(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            modifier = Modifier
                .background(MaterialTheme.colorScheme.primary, MaterialTheme.shapes.small)
                // Material's own button padding.
                .padding(horizontal = 24.dp, vertical = 10.dp),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}
