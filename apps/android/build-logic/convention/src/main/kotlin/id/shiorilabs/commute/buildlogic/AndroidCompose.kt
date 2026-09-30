package id.shiorilabs.commute.buildlogic

import com.android.build.api.dsl.CommonExtension
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.jetbrains.kotlin.compose.compiler.gradle.ComposeCompilerGradlePluginExtension
import org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension

/** Gradle property that turns on the Compose compiler's metrics/reports output for a build. */
private const val COMPOSE_METRICS_PROPERTY = "commute.enableComposeCompilerMetrics"

/** Root-relative path of the shared stability configuration consumed by every Compose module. */
private const val STABILITY_CONFIG_FILE = "compose-stability.conf"

/**
 * Enables Compose (build feature + compiler plugin) and applies the project-wide experimental
 * opt-ins.
 *
 * Also points the compiler at the shared [STABILITY_CONFIG_FILE] and, on request, has it emit
 * stability/recomposition reports — see [configureComposeCompiler].
 */
internal fun Project.configureAndroidCompose(
    commonExtension: CommonExtension,
) {
    pluginManager.apply("org.jetbrains.kotlin.plugin.compose")

    commonExtension.buildFeatures.compose = true

    extensions.configure<KotlinAndroidProjectExtension> {
        compilerOptions {
            optIn.addAll(
                "androidx.compose.material3.ExperimentalMaterial3Api",
                "androidx.compose.foundation.layout.ExperimentalLayoutApi",
            )
        }
    }

    configureComposeCompiler()
}

/**
 * Wires the Compose compiler plugin's diagnostics.
 *
 * **Stability config** is always applied: `compose-stability.conf` at the project root lists types
 * the compiler can't prove stable but which this codebase only ever passes as immutable values.
 *
 * **Metrics/reports** are opt-in — they slow every Compose module's compile, so they run only when
 * asked for:
 *
 * ```
 * ./gradlew assembleRelease -Pcommute.enableComposeCompilerMetrics=true
 * ```
 *
 * Each module then writes to its own `build/compose-metrics` and `build/compose-reports`.
 */
private fun Project.configureComposeCompiler() {
    val metricsEnabled = providers.gradleProperty(COMPOSE_METRICS_PROPERTY)
        .map(String::toBoolean)
        .orElse(false)

    extensions.configure<ComposeCompilerGradlePluginExtension> {
        stabilityConfigurationFiles.add(
            rootProject.layout.projectDirectory.file(STABILITY_CONFIG_FILE),
        )

        if (metricsEnabled.get()) {
            metricsDestination.set(layout.buildDirectory.dir("compose-metrics"))
            reportsDestination.set(layout.buildDirectory.dir("compose-reports"))
        }
    }
}
