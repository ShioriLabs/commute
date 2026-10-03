plugins {
    alias(libs.plugins.commute.android.library.compose)
    // SettingsNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    // impl owns the settings_* strings + the logotype.
    namespace = "id.shiorilabs.commute.feature.settings"
}

dependencies {
    // UIState + coroutines (api).
    implementation(project(":core:common"))
    // Environment.appVersion — the version line.
    implementation(project(":core:config"))
    // SavedRepository, RecentSearchRepository.
    implementation(project(":core:datastore"))
    // The settings routes + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // CommuteIcons, CommuteIconButton, CommuteButton, SkeletonBlock, CommutePreviewScaffold.
    implementation(project(":core:ui"))
    // StationRepository — the saved stations page names each station.
    implementation(project(":feature:station:api"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // ViewModel + viewModelScope.
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    // collectAsStateWithLifecycle.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // hiltViewModel().
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // FakePreferencesDataStore — backs the repositories in the view model tests.
    testImplementation(testFixtures(project(":core:datastore")))
}
