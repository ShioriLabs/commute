package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp

@Composable
@NonRestartableComposable
fun VerticalSpacer(height: Dp) {
    Spacer(Modifier.height(height))
}

@Composable
@NonRestartableComposable
fun HorizontalSpacer(width: Dp) {
    Spacer(Modifier.width(width))
}

@Composable
@NonRestartableComposable
fun RowScope.FillSpacer() {
    Spacer(Modifier.weight(1f))
}
