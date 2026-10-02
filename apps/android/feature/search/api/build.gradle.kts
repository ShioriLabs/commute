plugins {
    alias(libs.plugins.commute.android.library)
}

android {
    // Shares the feature's package with :impl; the `.api` namespace only keeps the R classes apart.
    namespace = "id.shiorilabs.commute.feature.search.api"
}

dependencies {
    // Failure/Either in SearchRepository's signature → api.
    api(project(":core:common"))

    testImplementation(libs.junit)
}
