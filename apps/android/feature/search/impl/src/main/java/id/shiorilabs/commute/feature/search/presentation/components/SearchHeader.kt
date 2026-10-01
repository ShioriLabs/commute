package id.shiorilabs.commute.feature.search.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.components.HorizontalSpacer
import id.shiorilabs.commute.core.ui.components.VerticalSpacer
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.search.R

/** The field's fill and outline, the web's `bg-stone-100/80` and `border-stone-200/40`. */
private val FieldFill = Color(0xCCF5F5F4)
private val FieldOutline = Color(0x66E7E5E4)

/** The magnifier in the field, `text-slate-400`, and the clear button, `text-slate-500`. */
private val FieldIcon = Color(0xFF94A3B8)
private val ClearIcon = Color(0xFF64748B)

/**
 * Title, close button and the query field: the part of search that stays put while results scroll.
 * [belowField] sits under the field, inside the pinned header; the saved-station chips go there.
 */
@Composable
fun SearchHeader(
    query: String,
    onQueryChange: (String) -> Unit,
    onClose: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
    belowField: @Composable () -> Unit = {},
) {
    Column(
        modifier = modifier.padding(start = 32.dp, top = 32.dp, end = 32.dp, bottom = 16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.search_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            IconButton(
                onClick = onClose,
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    imageVector = CommuteIcons.Close,
                    contentDescription = stringResource(R.string.search_close_description),
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
        VerticalSpacer(16.dp)
        SearchField(
            query = query,
            onQueryChange = onQueryChange,
            focusRequester = focusRequester,
        )
        belowField()
    }
}

@Composable
private fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    focusRequester: FocusRequester,
) {
    val fieldDescription = stringResource(R.string.search_field_description)
    val textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onBackground)

    BasicTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = Modifier
            .fillMaxWidth()
            .focusRequester(focusRequester)
            .semantics { contentDescription = fieldDescription },
        textStyle = textStyle,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        decorationBox = { innerTextField ->
            Row(
                modifier = Modifier
                    .background(FieldFill, MaterialTheme.shapes.medium)
                    .border(2.dp, FieldOutline, MaterialTheme.shapes.medium)
                    .padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = CommuteIcons.Search,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = FieldIcon,
                )
                HorizontalSpacer(8.dp)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(vertical = 10.dp),
                ) {
                    if (query.isEmpty()) {
                        Text(
                            text = stringResource(R.string.search_field_placeholder),
                            style = textStyle,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        )
                    }
                    innerTextField()
                }
                if (query.isNotEmpty()) {
                    IconButton(
                        onClick = {
                            onQueryChange("")
                            focusRequester.requestFocus()
                        },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            imageVector = CommuteIcons.ClearField,
                            contentDescription = stringResource(R.string.search_field_clear),
                            modifier = Modifier.size(24.dp),
                            tint = ClearIcon,
                        )
                    }
                } else {
                    // Holds the field's height steady when the clear button appears.
                    HorizontalSpacer(36.dp)
                }
            }
        },
    )
}

@Preview(showBackground = true, backgroundColor = 0xFFFFFFFF)
@Composable
private fun SearchHeaderPreview() {
    CommutePreviewScaffold {
        SearchHeader(
            query = "",
            onQueryChange = {},
            onClose = {},
            focusRequester = FocusRequester(),
        )
    }
}

