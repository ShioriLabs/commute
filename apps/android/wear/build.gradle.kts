plugins {
    alias(libs.plugins.commute.android.application)
    alias(libs.plugins.androidx.baselineprofile)
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
    // The words a ride is named in, shared with the phone.
    implementation(project(":core:tripcopy"))
    implementation(project(":core:common"))
    // Plus Jakarta Sans and the roundel faces, the phone's own files.
    implementation(project(":core:font"))

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
    // The "OTW" and "Keberangkatan" complications on the watch face.
    implementation(libs.androidx.wear.watchface.complications.data.source.ktx)
    implementation(libs.play.services.wearable)
    // Asking for the notification permission: Play services brings a Fragment too old for it.
    implementation(libs.androidx.fragment)
    implementation(libs.kotlinx.coroutines.play.services)
    // Baseline Profile — ProfileInstaller applies the bundled profile on first run;
    // :baselineprofile-wear generates it (see WearBaselineProfileGenerator).
    implementation(libs.androidx.profileinstaller)
    baselineProfile(project(":baselineprofile-wear"))

    testImplementation(libs.junit)
}

// Debug-only NFC card-log tooling from the private submodule; linked only when it's checked out.
if (rootProject.file("private/cardlog-wear/build.gradle.kts").exists()) {
    dependencies {
        debugImplementation(project(":private:cardlog-wear"))
    }
}
