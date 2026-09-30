plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.feature.trip.api"
}

dependencies {
    implementation(project(":feature:station:api"))
    implementation(project(":core:common"))
}
