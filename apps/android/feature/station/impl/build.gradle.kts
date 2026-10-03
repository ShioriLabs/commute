plugins {
    alias(libs.plugins.commute.android.library.compose)
    // StationModule (@Binds), StationNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute.feature.station"
}

dependencies {
    // The repository interfaces, domain models, board loading and LineCard.
    implementation(project(":feature:station:api"))
    // apiCallToFailure, Failure, ServiceDayName, UIState, AMENITY_LABELS.
    implementation(project(":core:common"))
    // CommuteService + the generated Station/GroupedTimetable/OperatorWithLines (via :core:model).
    implementation(project(":core:network"))
    // Route.Station + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // SavedStationsRepository — the page's pin.
    implementation(project(":core:datastore"))
    // LineRoundel, CommuteIcons, SkeletonBlock, ProblemPanel, rememberJakartaNow, previews.
    implementation(project(":core:ui"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // Haze: the page and the timetable are what the frost behind their pinned headers blurs.
    implementation(libs.haze)

    // ViewModel + viewModelScope.
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    // collectAsStateWithLifecycle.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // hiltViewModel() with an assisted factory.
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":core:network")))
    // FakePreferencesDataStore — backs SavedStationsRepository in StationViewModelTest.
    testImplementation(testFixtures(project(":core:datastore")))
}
