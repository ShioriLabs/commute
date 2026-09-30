plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.feature.card.api"
}

dependencies {
    implementation(project(":core:common"))
}
