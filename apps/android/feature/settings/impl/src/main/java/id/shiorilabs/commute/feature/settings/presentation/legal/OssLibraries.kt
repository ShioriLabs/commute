package id.shiorilabs.commute.feature.settings.presentation.legal

/** An open-source library the app is built with, as the web's attributions page lists one. */
data class OssLibrary(
    val name: String,
    /** The SPDX id. */
    val license: String,
    val url: String,
)

/*
 * Kept by hand from gradle/libs.versions.toml, as the web keeps its list from package.json: a
 * library added to the catalog belongs here too.
 */

/** What ships inside the app. */
val OSS_RUNTIME_LIBRARIES: List<OssLibrary> = listOf(
    OssLibrary("androidx.activity:activity-compose", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/activity"),
    OssLibrary("androidx.compose", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/compose"),
    OssLibrary("androidx.compose.material3", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/compose-material3"),
    OssLibrary("androidx.core:core-ktx", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/core"),
    OssLibrary("androidx.datastore", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/datastore"),
    OssLibrary("androidx.hilt", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/hilt"),
    OssLibrary("androidx.lifecycle", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/lifecycle"),
    OssLibrary("androidx.navigation3", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/navigation3"),
    OssLibrary("androidx.profileinstaller", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/profileinstaller"),
    OssLibrary("arrow-core", "Apache-2.0", "https://github.com/arrow-kt/arrow"),
    OssLibrary("dagger-hilt", "Apache-2.0", "https://github.com/google/dagger"),
    OssLibrary("haze", "Apache-2.0", "https://github.com/chrisbanes/haze"),
    OssLibrary("kotlinx.coroutines", "Apache-2.0", "https://github.com/Kotlin/kotlinx.coroutines"),
    OssLibrary("kotlinx.serialization", "Apache-2.0", "https://github.com/Kotlin/kotlinx.serialization"),
    OssLibrary("ktor-client", "Apache-2.0", "https://github.com/ktorio/ktor"),
    OssLibrary("okhttp", "Apache-2.0", "https://github.com/square/okhttp"),
    OssLibrary("phosphor-icon", "MIT", "https://github.com/adamglin0/compose-phosphor-icon"),
)

/** What builds and tests the app without shipping in it. */
val OSS_BUILD_LIBRARIES: List<OssLibrary> = listOf(
    OssLibrary("Android Gradle Plugin", "Apache-2.0", "https://developer.android.com/build"),
    OssLibrary("androidx.baselineprofile", "Apache-2.0", "https://developer.android.com/jetpack/androidx/releases/benchmark"),
    OssLibrary("fabrikt", "Apache-2.0", "https://github.com/fabrikt-io/fabrikt"),
    OssLibrary("junit", "EPL-1.0", "https://github.com/junit-team/junit4"),
    OssLibrary("kotlin", "Apache-2.0", "https://github.com/JetBrains/kotlin"),
    OssLibrary("ksp", "Apache-2.0", "https://github.com/google/ksp"),
)
