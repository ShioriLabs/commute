plugins {
    alias(libs.plugins.commute.android.library.compose)
    // Route destinations are @Serializable NavKeys so the Nav3 back stack survives process death.
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.core.navigation"
}

dependencies {
    implementation(project(":core:common"))

    // api, like the foundation artifact below: a consumer that gets foundation transitively needs
    // the BOM with it to resolve a version.
    api(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    // PaddingValues in NavGraphScope's public surface.
    api(libs.androidx.compose.foundation)
    // Route publicly extends navigation3's NavKey and NavGraphContribution takes an
    // EntryProviderScope, so consumers need both on their classpath → api, not implementation.
    api(libs.androidx.navigation3.runtime)

    // Route's generated serializer needs kotlinx-serialization on this module's own compile
    // classpath — a transitive copy isn't enough for the compiler plugin.
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}
