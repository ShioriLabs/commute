import java.net.URI

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

// The snapshot CardStationNames falls back on when the phone has never fetched the station list:
// every station's id and name from the production API. Run by hand when stations are renamed; the
// build never fetches it.
tasks.register("updateCardStationNames") {
    group = "commute"
    description = "Rewrites assets/card/station_names.json from the production API's /stations."
    val output = file("src/main/assets/card/station_names.json")
    outputs.file(output)
    outputs.upToDateWhen { false }
    doLast {
        val connection = URI("https://api.commute.shiorilabs.id/stations").toURL().openConnection()
        connection.setRequestProperty("User-Agent", "commute-android-build")
        val body = connection.getInputStream().use { it.readBytes().decodeToString() }

        @Suppress("UNCHECKED_CAST")
        val rows = (groovy.json.JsonSlurper().parseText(body) as Map<String, Any?>)["data"] as List<Map<String, Any?>>
        val names = rows.associate { it["id"] as String to it["name"] as String }.toSortedMap()
        check(names.isNotEmpty()) { "The API sent no stations" }
        output.parentFile.mkdirs()
        output.writeText(groovy.json.JsonOutput.prettyPrint(groovy.json.JsonOutput.toJson(names)) + "\n")
        logger.lifecycle("Wrote ${names.size} station names to $output")
    }
}

dependencies {
    implementation(project(":feature:card:api"))
    implementation(project(":core:common"))
    // Environment: a dump's app version.
    implementation(project(":core:config"))
    // Route.CardDumper + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    implementation(project(":core:ui"))
    // StationDirectory: the names of the stations a card's entries point at.
    implementation(project(":feature:station:api"))

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
