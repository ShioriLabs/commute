plugins {
    // CardTap is a composable seam the home screen renders through.
    alias(libs.plugins.commute.android.library.compose)
}

android {
    namespace = "id.shiorilabs.commute.feature.card.api"
}

dependencies {
    implementation(project(":core:common"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
}
