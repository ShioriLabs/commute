plugins {
    alias(libs.plugins.commute.android.library.compose)
    // SearchModule (@Binds) + SearchNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    // impl owns the search_* strings + the not-found illustration.
    namespace = "id.shiorilabs.commute.feature.search"
}

dependencies {
    // UIState/Failure/toUserMessage, apiCallToFailure + arrow/coroutines (api).
    implementation(project(":core:common"))
    // CommuteService + the generated SearchableIndex (via :core:model, api).
    implementation(project(":core:network"))
    // RecentSearchRepository, SavedStationsRepository.
    implementation(project(":core:datastore"))
    // Route.Search + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // LineRoundel, CommuteEmptyState, CommuteIcons, colour ext, Spacers, CommutePreviewScaffold.
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
    testImplementation(testFixtures(project(":core:network")))
    testImplementation(testFixtures(project(":core:datastore")))
}
