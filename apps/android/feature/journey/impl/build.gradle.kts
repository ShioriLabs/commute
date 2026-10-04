plugins {
    alias(libs.plugins.commute.android.library.compose)
    // JourneyModule (@Binds), JourneyNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute.feature.journey"
}

dependencies {
    // JourneyRepository, the domain models and the OtwPanel seam this module binds.
    implementation(project(":feature:journey:api"))
    // Reserved for the IC card balance beside a fare, and "Mulai perjalanan" into trip mode.
    implementation(project(":feature:card:api"))
    implementation(project(":feature:trip:api"))
    // LineRepository (line keys to names and colours), sortLineKeysForDisplay, formatPlatformCode.
    implementation(project(":feature:station:api"))
    // The station index the picker offers, and the fuzzy matcher it ranks with.
    implementation(project(":feature:search:api"))
    // apiCallToFailure, Failure, UIState, OPERATOR_NAMES.
    implementation(project(":core:common"))
    // CommuteService + the generated TripResult (via :core:model).
    implementation(project(":core:network"))
    // QueryClient — the repository's cache, memory and disk.
    implementation(project(":core:query"))
    // Route.Journey + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // FarePreferencesRepository: the settings and the recently picked stations.
    implementation(project(":core:datastore"))
    // LineRoundel, CommuteIcons, sheets, SkeletonBlock, ProblemPanel, previews.
    implementation(project(":core:ui"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    // Haze: the trip page is what the frost behind its pinned header blurs.
    implementation(libs.haze)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // ViewModel + viewModelScope.
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    // collectAsStateWithLifecycle, LifecycleResumeEffect.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // hiltViewModel() with an assisted factory.
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":core:network")))
    testImplementation(testFixtures(project(":core:query")))
    // FakePreferencesDataStore — backs FarePreferencesRepository in JourneyViewModelTest.
    testImplementation(testFixtures(project(":core:datastore")))
}
