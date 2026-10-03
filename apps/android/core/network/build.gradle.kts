@file:Suppress("UnstableApiUsage")

plugins {
    alias(libs.plugins.commute.android.library)
    alias(libs.plugins.commute.android.hilt)
    // Response, the envelope every route shares, is @Serializable.
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.core.network"

    // FakeCommuteService is published as a fixture so feature repositories can be unit-tested
    // without each one hand-rolling the interface. Fixtures are a separate artifact — none of this
    // reaches the app.
    testFixtures {
        enable = true
    }
}

dependencies {
    // ApiException + Failure/toFailure, which service impls throw and repositories map — api so
    // consumers (feature repos) see them transitively. It also re-exports coroutines.
    api(project(":core:common"))
    // Wire models returned inside the Response envelopes by the service interface.
    api(project(":core:model"))
    // Environment drives the API base URL.
    api(project(":core:config"))

    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.ktor.client.mock)
}
