plugins {
    alias(libs.plugins.commute.android.application)
}

android {
    namespace = "id.shiorilabs.commute.wear"

    defaultConfig {
        // Shared with the phone app: that is what pairs a Wear companion with it.
        applicationId = "id.shiorilabs.commute"
        versionCode = 1
        versionName = "1.0"
    }
}

dependencies {
    implementation(project(":core:trip"))
    implementation(project(":core:model"))
    implementation(project(":core:common"))
}
