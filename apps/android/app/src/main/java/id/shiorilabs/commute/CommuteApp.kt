package id.shiorilabs.commute

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBars
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.rememberCommuteNavigator
import id.shiorilabs.commute.core.ui.theme.CommuteTheme

@Composable
fun CommuteApp() {
    CommuteTheme {
        val navigator = rememberCommuteNavigator()
        val screenPadding = WindowInsets.systemBars.asPaddingValues()

        CompositionLocalProvider(LocalNavigator provides navigator) {
            CommuteNavDisplay(
                navigator = navigator,
                screenPadding = { screenPadding },
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background),
            )
        }
    }
}
