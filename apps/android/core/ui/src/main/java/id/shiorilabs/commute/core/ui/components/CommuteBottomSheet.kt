package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import kotlinx.coroutines.launch

/** The web's `bg-slate-950/25` scrim. */
private val SheetScrim = Color(0x400F172A)

/**
 * The surface a choice slides up on: a white sheet with a title and a close button, the web's
 * `CriteriaSheetShell`. Every sheet a rider can open from one surface looks like this, so tapping
 * from a settings list into one setting brings the same kind of object up, not a second visual
 * language.
 *
 * Content-sized unless [fullHeight]: a few rows in a full-screen panel read as a navigation rather
 * than a setting. [content] is handed `hide`, which slides the sheet away before [onDismiss] runs,
 * for a row that closes it on tap.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommuteBottomSheet(
    title: String,
    closeDescription: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    fullHeight: Boolean = false,
    content: @Composable ColumnScope.(hide: () -> Unit) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val hide: () -> Unit = {
        scope.launch { state.hide() }.invokeOnCompletion {
            if (!state.isVisible) {
                onDismiss()
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        sheetState = state,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        containerColor = Color.White,
        contentColor = MaterialTheme.colorScheme.onBackground,
        scrimColor = SheetScrim,
        dragHandle = null,
    ) {
        Column(modifier = if (fullHeight) Modifier.fillMaxHeight() else Modifier) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = title,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                CommuteIconButton(onClick = hide, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = CommuteIcons.Close,
                        contentDescription = closeDescription,
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
            content(hide)
        }
    }
}
