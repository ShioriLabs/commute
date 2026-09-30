plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.feature.trip"
}

dependencies {
    implementation(project(":feature:trip:api"))
    implementation(project(":feature:station:api"))
    implementation(project(":core:trip"))
    implementation(project(":core:notification"))
    implementation(project(":core:common"))
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))
}
