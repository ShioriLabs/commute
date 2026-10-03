plugins {
    alias(libs.plugins.commute.android.library.compose)
}

android {
    namespace = "id.shiorilabs.commute.core.ui"
}

dependencies {
    // Screens read LocalNavigator and previews provide it → api so consumers see it transitively.
    api(project(":core:navigation"))
    // UIState/Failure surface through the shared components.
    api(project(":core:common"))
    implementation(project(":core:datastore"))

    // Compose UI + design system.
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.runtime)
    // WindowCompat — CommuteTheme sets the system-bar icon appearance.
    implementation(libs.androidx.core.ktx)
    // rememberJakartaNow pauses with the lifecycle.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // NavDisplay's transition metadata keys, for navCardMorphMetadata.
    implementation(libs.androidx.navigation3.ui)
    // Phosphor — icon set surfaced through the CommuteIcons design-system object.
    implementation(libs.phosphor.icons)
    // The frost behind pinned headers. Every `hazeBlur` lives here; features only mark sources, and
    // the backdrop takes their HazeState, hence api.
    api(libs.haze)
    implementation(libs.haze.blur)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
}
