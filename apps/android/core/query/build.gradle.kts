@file:Suppress("UnstableApiUsage")

plugins {
    alias(libs.plugins.commute.android.library)
    // Hilt brings KSP, which Room's compiler runs on too.
    alias(libs.plugins.commute.android.hilt)
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.core.query"

    defaultConfig {
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // FakeQueryStore and FakeNetworkMonitor are published as fixtures, so a repository test can run
    // a real QueryClient on the JVM without a database.
    testFixtures {
        enable = true
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    // Either/Failure, UIState, Fetched and NetworkMonitor appear in the public API.
    api(project(":core:common"))
    // QuerySpec carries the KSerializer its entry is stored with.
    api(libs.kotlinx.serialization.json)

    implementation(libs.androidx.room.runtime)
    ksp(libs.androidx.room.compiler)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
