plugins {
    alias(libs.plugins.commute.android.library.compose)
}

android {
    namespace = "id.shiorilabs.commute.core.notification"
}

dependencies {
    implementation(project(":core:common"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    // The in-context permission request.
    implementation(libs.androidx.activity.compose)
    // NotificationManagerCompat and its channels.
    api(libs.androidx.core.ktx)
}
