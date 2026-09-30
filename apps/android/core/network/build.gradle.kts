plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.network"
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:config"))
    implementation(project(":core:common"))
}
