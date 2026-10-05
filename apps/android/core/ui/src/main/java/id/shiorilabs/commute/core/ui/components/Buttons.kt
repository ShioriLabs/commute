package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/*
 * Material's buttons draw their own ripple rather than the theme's indication, so they can't take
 * the app's press feedback. These stand in for them, built on `clickable`, which does.
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

/** Which of the app's two buttons: the brand pink, or slate with pink, as the web pairs them. */
enum class CommuteButtonVariant { Primary, Secondary }

/**
 * The app's button, the web's `p-4 rounded-xl text-sm font-bold`: "OTW Ke Sini" and "Jadwal
 * Lengkap" on a station, "Udah turun" and "Berhenti" on a trip, "Coba lagi" when a page won't load.
 *
 * [modifier] comes before the button's own shape and fill, so a caller's padding stays outside
 * the rounded corners. [content] is laid out in a row, centred, and its [Icon]s and [Text]s take
 * the button's content colour unless they say otherwise. It doesn't fill the height it's given: a
 * row of buttons that should match heights says so with `fillMaxHeight`.
 */
@Composable
fun CommuteButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: CommuteButtonVariant = CommuteButtonVariant.Primary,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val (container, contentColor) = when {
        !enabled -> Slate200 to Slate500
        variant == CommuteButtonVariant.Primary -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.onPrimary
        else -> Slate200 to MaterialTheme.colorScheme.primary
    }
    CompositionLocalProvider(LocalContentColor provides contentColor) {
        Row(
            modifier = modifier
                .clip(ButtonShape)
                .background(container)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

/** The common [CommuteButton]: a label, with an icon before or after it. */
@Composable
fun CommuteButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: CommuteButtonVariant = CommuteButtonVariant.Primary,
    enabled: Boolean = true,
    leadingIcon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
) {
    CommuteButton(onClick = onClick, modifier = modifier, variant = variant, enabled = enabled) {
        leadingIcon?.let { CommuteButtonIcon(it) }
        CommuteButtonText(text)
        trailingIcon?.let { CommuteButtonIcon(it) }
    }
}

/** A [CommuteButton]'s label, for a slot that needs more than [CommuteButton]'s `text`. */
@Composable
fun CommuteButtonText(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Bold,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * A [CommuteButton]'s icon. Decorative unless [contentDescription] says otherwise: the label beside
 * it already says what the button does.
 */
@Composable
fun CommuteButtonIcon(icon: ImageVector, modifier: Modifier = Modifier, contentDescription: String? = null) {
    Icon(imageVector = icon, contentDescription = contentDescription, modifier = modifier.size(20.dp))
}

private val ButtonShape = RoundedCornerShape(12.dp)

/** The web's slate-200: the secondary button, and any button that can't be pressed yet. */
private val Slate200 = Color(0xFFE2E8F0)

/** The web's slate-500: a disabled button's label. */
private val Slate500 = Color(0xFF64748B)

@Preview(showBackground = true)
@Composable
private fun CommuteButtonPreview() {
    CommutePreviewScaffold {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CommuteButton(text = "OTW!", onClick = {}, modifier = Modifier.fillMaxWidth(), leadingIcon = CommuteIcons.NavigationArrow)
            CommuteButton(text = "Berhenti", onClick = {}, variant = CommuteButtonVariant.Secondary, leadingIcon = CommuteIcons.Close)
            CommuteButton(text = "Buka di Maps", onClick = {}, variant = CommuteButtonVariant.Secondary, trailingIcon = CommuteIcons.ExternalLink)
            CommuteButton(text = "Bisa mulai 07.40", onClick = {}, enabled = false)
            CommuteButton(text = "Coba lagi", onClick = {})
        }
    }
}
