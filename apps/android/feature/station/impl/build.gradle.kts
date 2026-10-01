plugins {
    alias(libs.plugins.commute.android.library)
    // StationModule (@Binds) → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute.feature.station"
}

dependencies {
    // The repository interfaces and domain models this implements.
    implementation(project(":feature:station:api"))
    // apiCallToFailure, Failure, ServiceDayName.
    implementation(project(":core:common"))
    // CommuteService + the generated Station/GroupedTimetable/OperatorWithLines (via :core:model).
    implementation(project(":core:network"))

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(testFixtures(project(":core:network")))
}
