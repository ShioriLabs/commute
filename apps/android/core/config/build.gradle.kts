plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.config"
}

dependencies {
    // Pure config holder: plain Kotlin data with no BuildConfig coupling — :app owns the build
    // config fields and provides Environment via DI.
    implementation(project(":core:common"))
}
