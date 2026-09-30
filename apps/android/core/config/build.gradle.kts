plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.config"
}

dependencies {
    implementation(project(":core:common"))
}
