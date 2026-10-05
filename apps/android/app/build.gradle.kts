plugins {
    alias(libs.plugins.commute.android.application)
    alias(libs.plugins.commute.android.hilt)
    alias(libs.plugins.androidx.baselineprofile)
}

android {
    namespace = "id.shiorilabs.commute"

    // SDK levels, Java 11 and Compose all come from the `commute.android.application` convention.

    defaultConfig {
        applicationId = "id.shiorilabs.commute"
        versionCode = 1
        versionName = "1.0"
    }

    // One flavor, `production`, from the `commute.android.application` convention, as is signing.
    // A debug build can still be pointed at a local API with
    // `-Pcommute.apiBaseUrl=http://10.0.2.2:3000`; a build type's field outranks the flavor's.
    // Release always talks to production.
    productFlavors {
        getByName("production") {
            buildConfigField("String", "API_BASE_URL", "\"https://api.commute.shiorilabs.id\"")
        }
    }

    buildTypes {
        debug {
            providers.gradleProperty("commute.apiBaseUrl").orNull?.let { localApi ->
                buildConfigField("String", "API_BASE_URL", "\"$localApi\"")
            }
        }
        release {
            // R8. On a Galaxy S23, with the station page's cards as separate list items, the frame
            // a station page opens on went from about 85 ms to about 52; builds take a few
            // minutes longer. Switched on with isMinifyEnabled rather than AGP 9's `optimization`
            // block: the Baseline Profile plugin derives its `nonMinifiedRelease` variant by turning
            // isMinifyEnabled off, and with the block it stayed minified, so the generated profile
            // named obfuscated classes that change from one build to the next.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

dependencies {
    // Core modules
    implementation(project(":core:common"))
    implementation(project(":core:model"))
    implementation(project(":core:config"))
    implementation(project(":core:datastore"))
    implementation(project(":core:network"))
    implementation(project(":core:query"))
    implementation(project(":core:notification"))
    implementation(project(":core:location"))
    implementation(project(":core:trip"))
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))

    // Features — each contributes its own nav entries; nothing here references their screens.
    implementation(project(":feature:search:impl"))
    implementation(project(":feature:station:impl"))
    implementation(project(":feature:journey:impl"))
    implementation(project(":feature:hub:impl"))
    implementation(project(":feature:line:impl"))
    implementation(project(":feature:saved:impl"))
    implementation(project(":feature:trip:impl"))
    // The running trip's bar, pinned over every screen.
    implementation(project(":feature:trip:api"))
    implementation(project(":feature:card:impl"))
    implementation(project(":feature:settings:impl"))

    // AndroidX
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.runtime)
    // Navigation 3
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    // Baseline Profile — ProfileInstaller applies the bundled profile on first run; :baselineprofile
    // generates it (`./gradlew :app:generateProductionReleaseBaselineProfile`).
    implementation(libs.androidx.profileinstaller)
    baselineProfile(project(":baselineprofile"))
}
