plugins {
    alias(libs.plugins.commute.android.library.compose)
    // LineModule (@Binds), LineNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute.feature.line"
}

dependencies {
    // LineRepository + LineInfo: the dictionary the other-line badges resolve against.
    implementation(project(":feature:station:api"))
    // Failure, UIState, OPERATOR_NAMES.
    implementation(project(":core:common"))
    // CommuteService + the generated LineDetail (via :core:model).
    implementation(project(":core:network"))
    // QueryClient — the line's cache, memory and disk.
    implementation(project(":core:query"))
    // Route.Line/Route.Station + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // LineRoundel, CommuteIcons, SkeletonBlock, CommuteEmptyState, NoticeBanner, the frosted page.
    implementation(project(":core:ui"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // Haze: the page is what the frost behind its pinned header blurs.
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
    // FakeQueryStore + FakeNetworkMonitor — a real QueryClient under LineDetailRepositoryImplTest.
    testImplementation(testFixtures(project(":core:query")))
}
