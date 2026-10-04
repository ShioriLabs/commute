plugins {
    // OtwPanel is a composable seam the search screen renders through.
    alias(libs.plugins.commute.android.library.compose)
}

android {
    // Shares the feature's package with :impl; the `.api` namespace only keeps the R classes apart.
    namespace = "id.shiorilabs.commute.feature.journey.api"
}

dependencies {
    // Failure/Either in JourneyRepository's signature → api.
    api(project(":core:common"))
    // Query in JourneyRepository.observeTrips → api.
    api(project(":core:query"))
    // Route.Otw in OtwPanel's signature → api.
    api(project(":core:navigation"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    // PaddingValues in OtwPanel's signature.
    implementation(libs.androidx.compose.foundation)
}
