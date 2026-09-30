plugins {
    // Pure Kotlin: :core:trip depends on the wire models and must stay free of Android.
    alias(libs.plugins.commute.kotlin.library)
}
