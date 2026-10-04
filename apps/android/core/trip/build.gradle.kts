plugins {
    alias(libs.plugins.commute.kotlin.library)
    // A trip and its progress are stored whole, so a killed service picks up where it was.
    alias(libs.plugins.commute.kotlin.serialization)
}

dependencies {
    implementation(project(":core:model"))
    // GeoPoint and the distance maths.
    api(project(":core:common"))
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}
