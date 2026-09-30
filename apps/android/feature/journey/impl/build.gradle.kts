plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.feature.journey"
}

dependencies {
    implementation(project(":feature:journey:api"))
    implementation(project(":feature:card:api"))
    implementation(project(":feature:trip:api"))
    implementation(project(":feature:station:api"))
    implementation(project(":core:common"))
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))
}
