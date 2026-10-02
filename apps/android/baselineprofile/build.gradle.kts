plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.androidx.baselineprofile)
}

android {
    namespace = "id.shiorilabs.commute.baselineprofile"

    compileSdk {
        version = release(37)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    defaultConfig {
        // Generating a Baseline Profile needs API 33+ (or a rooted 28+); macrobenchmark itself 23+.
        minSdk = 28
        targetSdk = 37

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // The app under test. The Baseline Profile plugin wires the generated profile back into it.
    targetProjectPath = ":app"

    // Mirrors :app's flavor dimension so AGP can match the variant under test. targetAppId tells the
    // generator which package to launch: the plugin doesn't reliably supply it for a flavored app.
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
