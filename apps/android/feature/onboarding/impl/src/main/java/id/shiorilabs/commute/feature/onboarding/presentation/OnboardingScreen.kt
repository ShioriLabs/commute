package id.shiorilabs.commute.feature.onboarding.presentation

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.R as CoreUiR
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.NoticeBanner
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.onboarding.R

/**
 * The closed test's welcome page, the app's first screen until the rider goes past it: what this
 * build is, and that going on means agreeing to the privacy policy and terms, each a tap away.
 * "Lanjut" makes home the root, so back from it leaves the app rather than coming back here.
 */
@Composable
fun OnboardingScreen(
    innerPadding: PaddingValues,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    OnboardingContent(
        innerPadding = innerPadding,
        onPrivacyPolicy = { navigator.goTo(Route.SettingsPrivacyPolicy) },
        onTerms = { navigator.goTo(Route.SettingsTerms) },
        onContinue = {
            viewModel.finish()
            navigator.startOver(Route.Home)
        },
    )
}

@Composable
private fun OnboardingContent(
    innerPadding: PaddingValues,
    onPrivacyPolicy: () -> Unit = {},
    onTerms: () -> Unit = {},
    onContinue: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        // Scrolls on its own, so a small screen or a large font still keeps "Lanjut" in reach.
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            Image(
                painter = painterResource(CoreUiR.drawable.img_logotype),
                contentDescription = stringResource(R.string.onboarding_logotype),
                modifier = Modifier.height(28.dp),
            )
            Spacer(modifier = Modifier.height(96.dp))
            Text(
                text = stringResource(R.string.onboarding_title),
                style = MaterialTheme.typography.displaySmall.copy(fontSize = 40.sp, lineHeight = 48.sp),
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(48.dp))
            NoticeBanner(message = stringResource(R.string.onboarding_notice))
            Spacer(modifier = Modifier.height(24.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            ConsentText(onPrivacyPolicy = onPrivacyPolicy, onTerms = onTerms)
            CommuteButton(
                text = stringResource(R.string.onboarding_continue),
                onClick = onContinue,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** "Dengan melanjutkan, kamu setuju dengan …", the policy and the terms each a link to its page. */
@Composable
private fun ConsentText(onPrivacyPolicy: () -> Unit, onTerms: () -> Unit) {
    val policy = stringResource(R.string.onboarding_privacy_policy)
    val terms = stringResource(R.string.onboarding_terms)
    val sentence = stringResource(R.string.onboarding_consent, POLICY_SLOT, TERMS_SLOT)
    val linkStyle = TextLinkStyles(SpanStyle(color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold))
    val text = buildAnnotatedString {
        sentence.split(POLICY_SLOT, TERMS_SLOT).forEachIndexed { index, part ->
            append(part)
            when (index) {
                0 -> withLink(LinkAnnotation.Clickable(tag = "privacy", styles = linkStyle) { onPrivacyPolicy() }) { append(policy) }
                1 -> withLink(LinkAnnotation.Clickable(tag = "terms", styles = linkStyle) { onTerms() }) { append(terms) }
            }
        }
    }
    Text(text = text, style = MaterialTheme.typography.bodyMedium)
}

/** Stand-ins for the links in the consent sentence, split on to put each link in its place. */
private const val POLICY_SLOT = "\u0000policy\u0000"
private const val TERMS_SLOT = "\u0000terms\u0000"

@Preview(showBackground = true, heightDp = 874, widthDp = 402)
@Composable
private fun OnboardingPreview() {
    CommutePreviewScaffold {
        OnboardingContent(innerPadding = PaddingValues())
    }
}
