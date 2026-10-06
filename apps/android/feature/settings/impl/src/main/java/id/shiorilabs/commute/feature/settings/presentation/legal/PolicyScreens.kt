package id.shiorilabs.commute.feature.settings.presentation.legal

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.settings.R
import id.shiorilabs.commute.feature.settings.presentation.components.DocumentBody
import id.shiorilabs.commute.feature.settings.presentation.components.DocumentBullets
import id.shiorilabs.commute.feature.settings.presentation.components.DocumentSection
import id.shiorilabs.commute.feature.settings.presentation.components.HtmlText
import id.shiorilabs.commute.feature.settings.presentation.components.SettingsPage

/*
 * The privacy policy and the terms, word for word as the web has them: one pair of documents for
 * the site and the app alike, so they are revised together, the web's first.
 */

@Composable
fun PrivacyPolicyScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current
    PrivacyPolicyContent(innerPadding = innerPadding, onBack = { navigator.pop() })
}

@Composable
private fun PrivacyPolicyContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_privacy_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        DocumentBody {
            EffectiveDate()
            HtmlText(stringResource(R.string.settings_privacy_intro))
            DocumentSection(stringResource(R.string.settings_privacy_collected_title)) {
                HtmlText(stringResource(R.string.settings_privacy_collected_body))
                DocumentBullets(
                    listOf(
                        stringResource(R.string.settings_privacy_collected_1),
                        stringResource(R.string.settings_privacy_collected_2),
                        stringResource(R.string.settings_privacy_collected_3),
                    ),
                )
            }
            HtmlText(stringResource(R.string.settings_privacy_collected_outro))
            DocumentSection(stringResource(R.string.settings_privacy_location_title)) {
                HtmlText(stringResource(R.string.settings_privacy_location_body))
                DocumentBullets(
                    listOf(
                        stringResource(R.string.settings_privacy_location_1),
                        stringResource(R.string.settings_privacy_location_2),
                        stringResource(R.string.settings_privacy_location_3),
                        stringResource(R.string.settings_privacy_location_4),
                    ),
                )
            }
            HtmlText(stringResource(R.string.settings_privacy_location_outro))
            DocumentSection(stringResource(R.string.settings_privacy_use_title)) {
                HtmlText(stringResource(R.string.settings_privacy_use_body))
                DocumentBullets(
                    listOf(
                        stringResource(R.string.settings_privacy_use_1),
                        stringResource(R.string.settings_privacy_use_2),
                        stringResource(R.string.settings_privacy_use_3),
                        stringResource(R.string.settings_privacy_use_4),
                        stringResource(R.string.settings_privacy_use_5),
                    ),
                )
            }
            HtmlText(stringResource(R.string.settings_privacy_use_outro))
            DocumentSection(stringResource(R.string.settings_privacy_storage_title)) {
                HtmlText(stringResource(R.string.settings_privacy_storage_body))
            }
            DocumentSection(stringResource(R.string.settings_privacy_rights_title)) {
                HtmlText(stringResource(R.string.settings_privacy_rights_body))
            }
            DocumentSection(stringResource(R.string.settings_privacy_changes_title)) {
                HtmlText(stringResource(R.string.settings_privacy_changes_body))
            }
            DocumentSection(stringResource(R.string.settings_privacy_contact_title)) {
                HtmlText(stringResource(R.string.settings_privacy_contact_body))
            }
        }
    }
}

@Composable
fun TermsScreen(innerPadding: PaddingValues) {
    val navigator = LocalNavigator.current
    TermsContent(innerPadding = innerPadding, onBack = { navigator.pop() })
}

@Composable
private fun TermsContent(
    innerPadding: PaddingValues,
    onBack: () -> Unit = {},
) {
    SettingsPage(
        title = stringResource(R.string.settings_terms_title),
        innerPadding = innerPadding,
        onBack = onBack,
    ) {
        DocumentBody {
            EffectiveDate()
            HtmlText(stringResource(R.string.settings_terms_intro))
            DocumentSection(stringResource(R.string.settings_terms_service_title)) {
                HtmlText(stringResource(R.string.settings_terms_service_body))
            }
            DocumentSection(stringResource(R.string.settings_terms_license_title)) {
                HtmlText(stringResource(R.string.settings_terms_license_body))
                DocumentBullets(
                    listOf(
                        stringResource(R.string.settings_terms_license_1),
                        stringResource(R.string.settings_terms_license_2),
                        stringResource(R.string.settings_terms_license_3),
                    ),
                )
            }
            HtmlText(stringResource(R.string.settings_terms_license_support))
            HtmlText(stringResource(R.string.settings_terms_license_warning))
            DocumentSection(stringResource(R.string.settings_terms_privacy_title)) {
                HtmlText(stringResource(R.string.settings_terms_privacy_body))
            }
            DocumentSection(stringResource(R.string.settings_terms_liability_title)) {
                HtmlText(stringResource(R.string.settings_terms_liability_body))
            }
            DocumentSection(stringResource(R.string.settings_terms_changes_title)) {
                HtmlText(stringResource(R.string.settings_terms_changes_body))
            }
            DocumentSection(stringResource(R.string.settings_terms_law_title)) {
                HtmlText(stringResource(R.string.settings_terms_law_body))
            }
            DocumentSection(stringResource(R.string.settings_terms_contact_title)) {
                HtmlText(stringResource(R.string.settings_terms_contact_body))
            }
        }
    }
}

/** The date both documents took effect, over their text. */
@Composable
private fun EffectiveDate() {
    Text(
        text = stringResource(R.string.settings_legal_effective),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

@Preview(showBackground = true)
@Composable
private fun PrivacyPolicyContentPreview() {
    CommutePreviewScaffold {
        PrivacyPolicyContent(innerPadding = PaddingValues())
    }
}

@Preview(showBackground = true)
@Composable
private fun TermsContentPreview() {
    CommutePreviewScaffold {
        TermsContent(innerPadding = PaddingValues())
    }
}
