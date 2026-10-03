plugins {
    alias(libs.plugins.commute.android.library.compose)
}

android {
    // Shares the feature's package with :impl, as midori's features do; the `.api` namespace only
    // keeps the two modules' R classes apart.
    namespace = "id.shiorilabs.commute.feature.station.api"
}

dependencies {
    // Failure/Either in the repository signatures, ServiceDayName + service-day helpers → api.
    api(project(":core:common"))
    // Query in the observe signatures, which the board is built from → api.
    api(project(":core:query"))
    // LineCard: theme, colour ext, Spacers, CommutePreviewScaffold.
    implementation(project(":core:ui"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    // Phosphor's navigation arrow on the direction headers.
    implementation(libs.phosphor.icons)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    // StationBoardsTest collects the board flow.
    testImplementation(libs.kotlinx.coroutines.test)
}
