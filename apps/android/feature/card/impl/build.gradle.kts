plugins {
    alias(libs.plugins.commute.android.library.compose)
    // The dumper's nav contribution (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
    // CardDump, saved as JSON.
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.feature.card"
}

// Future in-app e-money reader sources from the private submodule; compiled into this module only
// when it's checked out. A @Provides @IntoSet CardReader there joins CardModule's reader set;
// absent → only the FeliCa readers (KMT + Japan IC). See private/card-impl/README.md. Configured
// via the current AGP DSL type to avoid the legacy sourceSets accessor's classloader cast.
rootProject.file("private/card-impl/src/main/java").takeIf { it.exists() }?.let { dir ->
    extensions.configure(com.android.build.api.dsl.LibraryExtension::class.java) {
        // kotlin, not java: built-in Kotlin leaves .kt files in an added java dir uncompiled.
        sourceSets.getByName("main").kotlin.srcDir(dir)
        sourceSets.getByName("test").kotlin.srcDir(rootProject.file("private/card-impl/src/test/java"))
    }
}

// Said on every build, in a task so a configuration-cache hit still says it: a release built without
// the submodule loses the reader silently otherwise.
tasks.named("preBuild") {
    val included = rootProject.file("private/card-impl/src/main/java").exists()
    val message = "e-money reader: ${if (included) "included" else "absent, FeliCa only"}"
    doLast { logger.lifecycle(message) }
}

dependencies {
    implementation(project(":feature:card:api"))
    implementation(project(":core:common"))
    // Environment: a dump's app version.
    implementation(project(":core:config"))
    // Route.CardDumper + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))

    implementation(libs.kotlinx.serialization.json)

    implementation(libs.androidx.core.ktx)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // ViewModel + viewModelScope.
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    // collectAsStateWithLifecycle.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // hiltViewModel().
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
