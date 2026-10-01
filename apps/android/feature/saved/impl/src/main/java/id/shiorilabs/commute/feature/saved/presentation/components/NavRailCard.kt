package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.NavCardFacePart
import id.shiorilabs.commute.core.ui.morph.navCardFace
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

private val CardWidth = 168.dp
private val CardHeight = 128.dp

/** How far the icon's circle hangs past the card's bottom-end corner before being clipped. */
private val IconOverhang = 20.dp

/** The white wash behind the icon on an accent card. */
private const val ACCENT_ICON_WASH_ALPHA = 0.2f

/**
 * One card of the home rail: a bold [title] over a [subtitle], with [icon] in a circle clipped by
 * the bottom-end corner.
 *
 * [accent] fills the face with the brand colour instead of white. The rail holds several cards, so
 * the one action most people came for has to be visibly the primary one.
 *
 * @param description what the card does, read out in place of its visible text.
 */
@Composable
fun NavRailCard(
    title: String,
    subtitle: String,
    description: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    accent: Boolean = false,
) {
    val colorScheme = MaterialTheme.colorScheme
    val containerColor = if (accent) colorScheme.primary else colorScheme.surfaceContainerLowest
    val contentColor = if (accent) colorScheme.onPrimary else colorScheme.onSurface
    val borderColor = if (accent) colorScheme.primary else colorScheme.outlineVariant
    val iconWashColor = if (accent) {
        Color.White.copy(alpha = ACCENT_ICON_WASH_ALPHA)
    } else {
        colorScheme.secondaryContainer
    }
    val iconColor = if (accent) colorScheme.onPrimary else colorScheme.onSecondaryContainer

    Box(
        modifier = modifier
            .size(width = CardWidth, height = CardHeight)
            .clip(MaterialTheme.shapes.medium)
            .background(containerColor)
            .border(2.dp, borderColor, MaterialTheme.shapes.medium)
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                role = Role.Button
                onClick {
                    onClick()
                    true
                }
            },
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .navCardFace(NavCardFacePart.ICON)
                .offset(x = IconOverhang, y = IconOverhang)
                .background(iconWashColor, CircleShape)
                .padding(16.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = iconColor,
            )
        }
        Column(
            modifier = Modifier
                .navCardFace(NavCardFacePart.TEXT)
                .padding(16.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = contentColor,
            )
            Text(
                text = subtitle,
                // Tighter than the body default so a two-line subtitle clears the icon, as on web.
                style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 20.sp),
                color = contentColor,
            )
        }
    }
}

@Preview
@Composable
private fun NavRailCardAccentPreview() {
    CommutePreviewScaffold {
        NavRailCard(
            title = "Mau ke mana?",
            subtitle = "Cari stasiun\n& rute",
            description = "Cari stasiun, rute, dan tarif",
            icon = CommuteIcons.Search,
            onClick = {},
            accent = true,
        )
    }
}

@Preview
@Composable
private fun NavRailCardPreview() {
    CommutePreviewScaffold {
        NavRailCard(
            title = "Pengaturan",
            subtitle = "Aplikasi",
            description = "Pengaturan aplikasi",
            icon = CommuteIcons.Settings,
            onClick = {},
        )
    }
}
