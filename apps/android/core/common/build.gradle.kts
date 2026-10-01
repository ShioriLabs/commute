plugins {
    alias(libs.plugins.commute.kotlin.library)
}

dependencies {
    // Public surface: Either/Failure and StateFlow<UIState> leak through the ext signatures, so
    // consumers need them transitively → api.
    api(libs.arrow.core)
    api(libs.kotlinx.coroutines.core)

    // Internal: FailureMapping classifies Ktor's timeout exceptions.
    implementation(libs.ktor.client.core)

    testImplementation(libs.junit)
}
