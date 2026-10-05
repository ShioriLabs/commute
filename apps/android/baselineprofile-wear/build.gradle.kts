plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.androidx.baselineprofile)
}

android {
    namespace = "id.shiorilabs.commute.baselineprofile.wear"

    compileSdk {
        version = release(37)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    defaultConfig {
        // The watch app's own floor, Wear OS 4; a Baseline Profile needs 33+ unrooted anyway.
        minSdk = 33
        targetSdk = 37

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // The watch app under test. The Baseline Profile plugin wires the generated profile back into it.
    targetProjectPath = ":wear"

    // Mirrors :wear's flavor dimension so AGP can match the variant under test, as :baselineprofile
    // does for :app.
    flavorDimensions += "environment"
    productFlavors {
        create("production") {
            dimension = "environment"
            testInstrumentationRunnerArguments["targetAppId"] = "id.shiorilabs.commute"
        }
    }
}

dependencies {
    implementation(libs.androidx.junit)
    implementation(libs.androidx.uiautomator)
    implementation(libs.androidx.benchmark.macro.junit4)
}
