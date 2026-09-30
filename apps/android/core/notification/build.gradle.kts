plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.notification"
}

dependencies {
    implementation(project(":core:common"))
}
