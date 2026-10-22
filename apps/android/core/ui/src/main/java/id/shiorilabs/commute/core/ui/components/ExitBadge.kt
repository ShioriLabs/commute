package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import id.shiorilabs.commute.core.font.RoundelFontFamily
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.core.ui.theme.ExitYellow
import id.shiorilabs.commute.core.ui.theme.SignageNavy

/**
 * A station exit as MRTJ and KAI sign it, in the Jak Lingko colour roles: the code in signage navy
 * on exit yellow, set in the roundel face. The web's `ExitBadge`.
 *
 * [code] is shown as stored, which is the signed text (`D`, `Utara`), so a long one stretches the
 * square into a pill rather than being cut down to one letter. A fixed badge, like a roundel: its
 * text is in dp so the system font scale doesn't grow it out of its box.
 */
@Composable
fun ExitBadge(code: String, modifier: Modifier = Modifier) {
    val fontSize = with(LocalDensity.current) { 14.dp.toSp() }
    Box(
        modifier = modifier
            .defaultMinSize(minWidth = 22.dp, minHeight = 22.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(ExitYellow)
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = code,
            style = TextStyle(
                fontFamily = RoundelFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = fontSize,
                lineHeight = 1.em,
                color = SignageNavy,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
                lineHeightStyle = LineHeightStyle(
                    alignment = LineHeightStyle.Alignment.Center,
                    trim = LineHeightStyle.Trim.Both,
                ),
            ),
            maxLines = 1,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun ExitBadgePreview() {
    CommutePreviewScaffold {
        Row(modifier = Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ExitBadge(code = "B")
            ExitBadge(code = "D")
            ExitBadge(code = "Utara")
        }
    }
}
