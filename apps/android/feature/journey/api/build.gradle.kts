plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.feature.journey.api"
}

dependencies {
    implementation(project(":core:common"))
}
