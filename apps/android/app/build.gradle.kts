plugins {
    alias(libs.plugins.commute.android.application)
    alias(libs.plugins.commute.android.hilt)
}

android {
    namespace = "id.shiorilabs.commute"

    // SDK levels, Java 11 and Compose all come from the `commute.android.application` convention.

    defaultConfig {
        applicationId = "id.shiorilabs.commute"
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
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
    implementation(project(":core:trip"))
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))

    // Features — each contributes its own nav entries; nothing here references their screens.
    implementation(project(":feature:search:impl"))
    implementation(project(":feature:station:impl"))
    implementation(project(":feature:journey:impl"))
    implementation(project(":feature:saved:impl"))
    implementation(project(":feature:trip:impl"))
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
}
