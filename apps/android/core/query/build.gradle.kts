plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.query"
}

dependencies {
    implementation(project(":core:common"))
}
