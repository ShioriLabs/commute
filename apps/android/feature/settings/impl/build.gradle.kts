plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.feature.settings"
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))
}
