import id.shiorilabs.commute.buildlogic.invoke
import id.shiorilabs.commute.buildlogic.loadSecrets

plugins {
    alias(libs.plugins.commute.android.application)
    alias(libs.plugins.commute.android.hilt)
    alias(libs.plugins.androidx.baselineprofile)
    alias(libs.plugins.sentry.android)
}

android {
    namespace = "id.shiorilabs.commute"

    // SDK levels, Java 11 and Compose all come from the `commute.android.application` convention.

    defaultConfig {
        applicationId = "id.shiorilabs.commute"
        versionCode = 2
        versionName = "1.0"

        // Where crash reports go. A DSN only lets an app send events, so it is no secret.
        buildConfigField(
            "String",
            "SENTRY_DSN",
            "\"https://c4849a383dbd72106bc5dc6e5370fc45@o576669.ingest.us.sentry.io/4512204724961280\"",
        )
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

// Only for R8's mapping: every minified build gets an id that its crash reports carry, and with
// SENTRY_AUTH_TOKEN (an org token) in the environment or secret.properties, its mapping goes up to
// Sentry so those reports read as the source does. Without the token the build still works;
// build/outputs/mapping can be uploaded later with sentry-cli. Nothing else of the plugin's: the SDK
// is our own dependency, and the app isn't instrumented.
val sentryAuthToken = providers.environmentVariable("SENTRY_AUTH_TOKEN").orNull?.takeIf { it.isNotBlank() }
    ?: loadSecrets()("SENTRY_AUTH_TOKEN").takeIf { it.isNotEmpty() }

sentry {
    org.set("shiori-labs")
    projectName.set("commute-android")
    authToken.set(sentryAuthToken)

    includeProguardMapping.set(true)
    autoUploadProguardMapping.set(sentryAuthToken != null)
    // Builds for measuring and for the Baseline Profile never reach riders.
    ignoredBuildTypes.set(setOf("debug", "benchmarkRelease", "nonMinifiedRelease"))

    autoInstallation.enabled.set(false)
    tracingInstrumentation.enabled.set(false)
    includeDependenciesReport.set(false)
    telemetry.set(false)
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

    // Crash reports.
    implementation(libs.sentry.android)

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
