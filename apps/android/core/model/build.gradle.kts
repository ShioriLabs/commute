plugins {
    // Pure Kotlin: :core:trip depends on the wire models and must stay free of Android.
    alias(libs.plugins.commute.kotlin.library)
    alias(libs.plugins.commute.kotlin.serialization)
}

// The generator runs as a build-time tool on its own classpath; nothing from it is shipped.
val fabrikt: Configuration by configurations.creating

val apiSpec = rootProject.layout.projectDirectory.file("openapi/commute-internal.json")
val generatedModels = layout.buildDirectory.dir("generated/fabrikt")

/**
 * Generates the wire models from the checked-in OpenAPI snapshot, so no response model is typed by
 * hand and a schema change surfaces as a compile error rather than a parse failure on a phone.
 *
 * The snapshot is written by `pnpm --filter @commute/api openapi:internal`; rerun that when a
 * schema the app reads changes. Models only: `CommuteService` in :core:network is hand-written.
 */
val generateModels by tasks.registering(JavaExec::class) {
    group = "build"
    description = "Generates the wire models from openapi/commute-internal.json."

    inputs.file(apiSpec).withPathSensitivity(PathSensitivity.NONE)
    outputs.dir(generatedModels)

    classpath = fabrikt
    mainClass = "com.cjbooms.fabrikt.cli.CodeGen"
    args(
        "--api-file", apiSpec.asFile.path,
        "--base-package", "id.shiorilabs.commute.core.model",
        "--output-directory", generatedModels.get().asFile.path,
        "--targets", "HTTP_MODELS",
        "--serialization-library", "KOTLINX_SERIALIZATION",
        // The default emits jakarta.validation annotations, which would pull a server-side
        // dependency into the app for checks nothing runs.
        "--validation-library", "NO_VALIDATION",
        // A JSON object's values are never null in these responses; the default would make every
        // map lookup doubly nullable.
        "--http-model-opts", "NON_NULL_MAP_VALUES",
    )

    // A schema removed from the spec must not leave its class behind. The directory is captured
    // as a plain File: a task action that reaches back into this script can't be stored in the
    // configuration cache.
    val outputDirectory = generatedModels.get().asFile
    doFirst {
        outputDirectory.deleteRecursively()
    }
}

kotlin {
    sourceSets.main {
        kotlin.srcDir(generateModels.map { generatedModels.get().dir("src/main/kotlin") })
    }
}

dependencies {
    fabrikt(libs.fabrikt)

    // The serialization convention plugin only adds the compiler plugin, so the json artifact must
    // be declared directly. api: the generated sealed types carry @JsonClassDiscriminator, and
    // consumers decode them with a Json they configure.
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}
