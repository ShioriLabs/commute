plugins {
    alias(libs.plugins.commute.android.library.compose)
    // TripControllerImpl (@Binds), the nav contribution (@IntoSet), the service's injection.
    alias(libs.plugins.commute.android.hilt)
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.feature.trip"

    // The controller logs its trip's life to logcat; on the JVM that's a no-op, not a crash.
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(project(":feature:trip:api"))
    // LineRepository: a ride's line name and colour, for the Live Update's segments and the screen.
    implementation(project(":feature:station:api"))
    // The trip engine.
    implementation(project(":core:trip"))
    implementation(project(":core:location"))
    implementation(project(":core:notification"))
    implementation(project(":core:common"))
    implementation(project(":core:navigation"))
    // @ApplicationScope: the trip outlives every screen.
    implementation(project(":core:query"))
    // LineRoundel, FrostedHeaderPage, icons, previews.
    implementation(project(":core:ui"))

    implementation(libs.androidx.core.ktx)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.haze)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":core:location")))
}
