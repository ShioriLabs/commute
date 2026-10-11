plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    namespace = "id.shiorilabs.commute.core.tripcopy"
}

dependencies {
    // Headline and TripLeg: what the wording is of.
    api(project(":core:trip"))
}
