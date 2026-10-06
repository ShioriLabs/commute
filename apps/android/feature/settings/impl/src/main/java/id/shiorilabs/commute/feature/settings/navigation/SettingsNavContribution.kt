package id.shiorilabs.commute.feature.settings.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.navigation.NavGraphContribution
import id.shiorilabs.commute.core.navigation.NavGraphScope
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.morph.navCardMorphMetadata
import id.shiorilabs.commute.core.ui.motion.pageTransitionMetadata
import id.shiorilabs.commute.feature.settings.presentation.about.AboutScreen
import id.shiorilabs.commute.feature.settings.presentation.experimental.ExperimentalScreen
import id.shiorilabs.commute.feature.settings.presentation.home.SettingsScreen
import id.shiorilabs.commute.feature.settings.presentation.legal.CreativeAssetsScreen
import id.shiorilabs.commute.feature.settings.presentation.legal.DataAttributionsScreen
import id.shiorilabs.commute.feature.settings.presentation.legal.LegalScreen
import id.shiorilabs.commute.feature.settings.presentation.legal.OssAttributionsScreen
import id.shiorilabs.commute.feature.settings.presentation.legal.PrivacyPolicyScreen
import id.shiorilabs.commute.feature.settings.presentation.legal.TermsScreen
import id.shiorilabs.commute.feature.settings.presentation.location.LocationSettingsScreen
import id.shiorilabs.commute.feature.settings.presentation.managedata.ManageDataScreen
import id.shiorilabs.commute.feature.settings.presentation.otw.OtwSettingsScreen
import id.shiorilabs.commute.feature.settings.presentation.savedstations.SavedStationsSettingsScreen
import id.shiorilabs.commute.feature.settings.presentation.support.SupportScreen
import javax.inject.Inject

/**
 * Contributes settings and every page under it. Settings opens out of the home screen's
 * "Pengaturan" card, as search does out of its card; each page under it slides in over the one it
 * was opened from, as the station page does.
 */
class SettingsNavContribution @Inject constructor(
    private val environment: Environment,
) : NavGraphContribution {

    override fun EntryProviderScope<NavKey>.addEntries(scope: NavGraphScope) {
        entry<Route.Settings>(metadata = navCardMorphMetadata()) {
            SettingsScreen(appVersion = environment.appVersion, innerPadding = scope.screenPadding, debug = environment.debug)
        }
        entry<Route.SettingsSavedStations>(metadata = pageTransitionMetadata()) {
            SavedStationsSettingsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsManageData>(metadata = pageTransitionMetadata()) {
            ManageDataScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsLocation>(metadata = pageTransitionMetadata()) {
            LocationSettingsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsOtw>(metadata = pageTransitionMetadata()) {
            OtwSettingsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsExperimental>(metadata = pageTransitionMetadata()) {
            ExperimentalScreen(innerPadding = scope.screenPadding, debug = environment.debug)
        }
        entry<Route.SettingsLegal>(metadata = pageTransitionMetadata()) {
            LegalScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsPrivacyPolicy>(metadata = pageTransitionMetadata()) {
            PrivacyPolicyScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsTerms>(metadata = pageTransitionMetadata()) {
            TermsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsDataAttributions>(metadata = pageTransitionMetadata()) {
            DataAttributionsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsOssAttributions>(metadata = pageTransitionMetadata()) {
            OssAttributionsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsCreativeAssets>(metadata = pageTransitionMetadata()) {
            CreativeAssetsScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsSupport>(metadata = pageTransitionMetadata()) {
            SupportScreen(innerPadding = scope.screenPadding)
        }
        entry<Route.SettingsAbout>(metadata = pageTransitionMetadata()) {
            AboutScreen(appVersion = environment.appVersion, innerPadding = scope.screenPadding)
        }
    }
}
