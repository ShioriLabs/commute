package id.shiorilabs.commute.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.R
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold

/** Why a page's data isn't there, which picks a [LoadProblemState]'s copy. */
enum class LoadProblem {
    /** The device is offline: try again once connected. */
    OFFLINE,

    /** The request failed. */
    ERROR,

    /** It loaded, and there is nothing: no retry, since asking again would answer the same. */
    NO_DATA,
}

/**
 * The web's `EmptyState` for a load that came back with nothing to show: the station illustration,
 * a title and a line of copy for the [problem], and "Coba Lagi" for one worth retrying. [title] and
 * [message] override the copy, as the web's do, for a page whose subject isn't a schedule.
 */
@Composable
fun LoadProblemState(
    problem: LoadProblem,
    onRetry: () -> Unit = {},
    modifier: Modifier = Modifier,
    title: String? = null,
    message: String? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        CommuteEmptyState(
            illustration = painterResource(R.drawable.img_search_empty),
            illustrationDescription = stringResource(R.string.core_ui_problem_illustration_description),
            title = title ?: stringResource(
                when (problem) {
                    LoadProblem.OFFLINE -> R.string.core_ui_problem_offline_title
                    LoadProblem.ERROR -> R.string.core_ui_problem_error_title
                    LoadProblem.NO_DATA -> R.string.core_ui_problem_no_data_title
                },
            ),
            body = AnnotatedString(
                message ?: stringResource(
                    when (problem) {
                        LoadProblem.OFFLINE -> R.string.core_ui_problem_offline_message
                        LoadProblem.ERROR -> R.string.core_ui_problem_error_message
                        LoadProblem.NO_DATA -> R.string.core_ui_problem_no_data_message
                    },
                ),
            ),
        )
        if (problem != LoadProblem.NO_DATA) {
            CommuteButton(text = stringResource(R.string.core_ui_problem_retry), onClick = onRetry)
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun LoadProblemStatePreview() {
    CommutePreviewScaffold {
        LoadProblemState(problem = LoadProblem.OFFLINE, onRetry = {})
    }
}
