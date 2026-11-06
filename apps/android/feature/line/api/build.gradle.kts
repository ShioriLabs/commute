plugins {
    alias(libs.plugins.commute.android.library.compose)
}

android {
    // Shares the feature's package with :impl; the `.api` namespace only keeps the two modules'
    // R classes apart.
    namespace = "id.shiorilabs.commute.feature.line.api"
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
}
