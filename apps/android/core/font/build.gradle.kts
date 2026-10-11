plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.font"
}

dependencies {
    // FontFamily and Font.
    api(platform(libs.androidx.compose.bom))
    api(libs.androidx.compose.ui)
}
