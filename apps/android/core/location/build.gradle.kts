plugins {
    alias(libs.plugins.commute.android.library.compose)
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute.core.location"

    // FakeLocationClient, so a ViewModel test can hand out fixes without a device.
    testFixtures {
        enable = true
    }
}

dependencies {
    // Fix carries a GeoPoint.
    api(project(":core:common"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)

    // The Compose compiler runs over the fixtures too, and refuses to without a runtime to target.
    testFixturesImplementation(platform(libs.androidx.compose.bom))
    testFixturesImplementation(libs.androidx.compose.runtime)
}
