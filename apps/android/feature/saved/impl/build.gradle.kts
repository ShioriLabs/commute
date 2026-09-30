plugins {
    alias(libs.plugins.commute.android.library.compose)
    // SavedNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    // impl owns the saved_* strings + the station illustration.
    namespace = "id.shiorilabs.commute.feature.saved"
}

dependencies {
    // UIState + coroutines (api).
    implementation(project(":core:common"))
    // SavedStationsRepository.
    implementation(project(":core:datastore"))
    // Route.Home + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // CommuteEmptyState, CommuteIcons, Spacers, CommutePreviewScaffold.
    implementation(project(":core:ui"))

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
    // FakePreferencesDataStore — backs SavedStationsRepository in SavedStationsViewModelTest.
    testImplementation(testFixtures(project(":core:datastore")))
}
