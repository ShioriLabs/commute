plugins {
    alias(libs.plugins.commute.android.library.compose)
    // OnboardingNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute.feature.onboarding"
}

dependencies {
    // OnboardingPreferencesRepository: whether the welcome page was gone past.
    implementation(project(":core:datastore"))
    // Route.Onboarding/Home and the legal pages + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // The logotype, NoticeBanner, CommuteButton.
    implementation(project(":core:ui"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // ViewModel + viewModelScope.
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    // hiltViewModel().
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
