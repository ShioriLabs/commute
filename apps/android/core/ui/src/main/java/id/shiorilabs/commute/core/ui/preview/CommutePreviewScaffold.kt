package id.shiorilabs.commute.core.ui.preview

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import id.shiorilabs.commute.core.navigation.CommuteNavigator
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.rememberCommuteNavigator
import id.shiorilabs.commute.core.ui.theme.CommuteTheme

/**
 * Wraps `@Preview` content in [CommuteTheme] and provides [LocalNavigator], so any screen or
 * component renders without a missing-CompositionLocal crash.
 */
@Composable
fun CommutePreviewScaffold(
    navigator: CommuteNavigator = rememberCommuteNavigator(),
    content: @Composable () -> Unit,
) {
    CommuteTheme {
        CompositionLocalProvider(
            LocalNavigator provides navigator,
            content = content,
        )
    }
}
