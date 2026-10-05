plugins {
    alias(libs.plugins.commute.android.application)
}

android {
    namespace = "id.shiorilabs.commute.wear"

    defaultConfig {
        // Shared with the phone app: that is what pairs a Wear companion with it.
        applicationId = "id.shiorilabs.commute"
        // Wear OS 4: Wear OS 3 is API 30, below the phone's floor anyway, and nothing ships 31–32.
        minSdk = 33
        versionCode = 1
        versionName = "1.0"
    }
}

dependencies {
    // The phone's running trip, as it crosses over, and the trip maths to draw it.
    implementation(project(":core:wearable"))
    implementation(project(":core:trip"))
    implementation(project(":core:common"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.wear.compose.material3)
    implementation(libs.androidx.wear.compose.foundation)
    // The trip on the watch face while it runs.
    implementation(libs.androidx.wear.ongoing)
    // "Buka di HP".
    implementation(libs.androidx.wear.remote.interactions)
    implementation(libs.play.services.wearable)
    // Asking for the notification permission: Play services brings a Fragment too old for it.
    implementation(libs.androidx.fragment)
    implementation(libs.kotlinx.coroutines.play.services)
}
