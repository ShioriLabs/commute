plugins {
    alias(libs.plugins.commute.kotlin.library)
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:common"))
}
