@file:Suppress("UnstableApiUsage")

plugins {
    alias(libs.plugins.commute.android.library)
    alias(libs.plugins.commute.android.hilt)
    // SavedRepository serializes its entries via kotlinx-serialization Json.
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.core.datastore"

    // FakePreferencesDataStore is published as a fixture so every module testing a preference-backed
    // repo asserts against one shared in-memory store rather than hand-rolling one per feature.
    testFixtures {
        enable = true
    }
}

dependencies {
    api(project(":core:common"))

    // DataStore<Preferences> appears in the qualified @Provides return types + repo constructors.
    api(libs.androidx.datastore.preferences)

    // The serialization convention plugin only adds the compiler plugin, so the json artifact must
    // be declared directly.
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
