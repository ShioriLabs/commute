plugins {
    alias(libs.plugins.commute.kotlin.library)
    // The trip crosses to the watch as JSON.
    alias(libs.plugins.commute.kotlin.serialization)
}

dependencies {
    api(project(":core:trip"))
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}
