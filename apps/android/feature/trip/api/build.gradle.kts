plugins {
    // ActiveTripCard is a composable seam.
    alias(libs.plugins.commute.android.library.compose)
    // ActiveTrip is stored whole, the trip page's route with it.
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.feature.trip.api"
}

dependencies {
    // TripPlan, TripState and RiderAction are the seam's vocabulary.
    api(project(":core:trip"))
    // Route.Trip: the page a running trip was started from.
    api(project(":core:navigation"))
    implementation(project(":core:common"))
    api(libs.kotlinx.coroutines.core)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
}
