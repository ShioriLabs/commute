plugins {
    alias(libs.plugins.commute.android.library.compose)
    // MapNavModule (@IntoSet) + @HiltViewModel → Hilt + KSP.
    alias(libs.plugins.commute.android.hilt)
    // The web's manifest.json, points.json, map-lines.json and map-corridors.json, read as served.
    alias(libs.plugins.commute.kotlin.serialization)
}

android {
    namespace = "id.shiorilabs.commute.feature.map"

    // The renderer is Vulkan, which has no Java API: C++ under src/main/cpp, behind MapNative.
    ndkVersion = "27.2.12479018"

    defaultConfig {
        externalNativeBuild {
            cmake {
                // r27 doesn't yet align for 16 KB pages by default; r28 does.
                arguments += listOf("-DANDROID_STL=c++_static", "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON")
            }
        }
        consumerProguardFiles("consumer-rules.pro")
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    testOptions {
        unitTests.all {
            // The web's map data, for the tests that check the shipped copies and draw real routes.
            it.systemProperty("commute.webMapData", rootProject.layout.projectDirectory.dir("../web/app/data").asFile.absolutePath)
        }
    }
}

/**
 * Copies the web's map data into the module's assets: what the map draws and taps before it has
 * fetched the deployed copies, offline on first open. Read from the web app's sources in the same
 * repo, so a build always carries the edition the web shipped with it.
 */
abstract class BundleMapData : DefaultTask() {

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NAME_ONLY)
    abstract val sources: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile.resolve("map")
        out.deleteRecursively()
        out.mkdirs()
        sources.forEach { it.copyTo(out.resolve(it.name)) }
    }
}

val webApp = rootProject.layout.projectDirectory.dir("../web")
val bundleMapData = tasks.register<BundleMapData>("bundleMapData") {
    sources.from(
        webApp.file("public/maps/fdtj/manifest.json"),
        webApp.file("app/data/points.json"),
        webApp.file("app/data/label-points.json"),
        webApp.file("app/data/map-lines.json"),
        webApp.file("app/data/map-corridors.json"),
    )
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(bundleMapData, BundleMapData::outputDir)
    }
}

dependencies {
    // Failure, UIState, Fetched.
    implementation(project(":core:common"))
    // The HttpClient, and Environment.webBaseUrl through it.
    implementation(project(":core:network"))
    implementation(libs.ktor.client.core)
    // QueryClient — the manifest's and the tap targets' cache, memory and disk.
    implementation(project(":core:query"))
    // Route.Map/Route.Station + the NavGraphContribution/NavGraphScope contract.
    implementation(project(":core:navigation"))
    // CommuteIcons, CommuteIconButton, page transitions.
    implementation(project(":core:ui"))
    // DeveloperPreferencesRepository: the debug hitbox overlay's switch.
    implementation(project(":core:datastore"))
    // StationSheet, StationDirectory and LineRepository: the station sheet and its ring's colour.
    implementation(project(":feature:station:api"))
    // HubSheet and HubDirectory: the hub sheet, and the `HUB-…` tap targets' slugs.
    implementation(project(":feature:hub:api"))
    // LineSheet: an isolated line's sheet.
    implementation(project(":feature:line:api"))
    // MapRouteSheet, Journey: OTW in the map's sheet, and the journey drawn.
    implementation(project(":feature:journey:api"))
    // TripController: the running trip, drawn with the rider on it.
    implementation(project(":feature:trip:api"))

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)

    // ViewModel + viewModelScope.
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    // collectAsStateWithLifecycle, LifecycleStartEffect.
    implementation(libs.androidx.lifecycle.runtime.compose)
    // hiltViewModel().
    implementation(libs.hilt.navigation.compose)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // FakeQueryStore + FakeNetworkMonitor — a real QueryClient under MapAssetRepositoryTest.
    testImplementation(testFixtures(project(":core:query")))
    testImplementation(libs.ktor.client.mock)
}
