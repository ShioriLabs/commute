package id.shiorilabs.commute.buildlogic

import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Project
import java.util.Properties

/** The flavor dimension every application module shares. */
const val ENVIRONMENT_DIMENSION = "environment"

/** The one environment: Commute has a single backend. */
const val PRODUCTION_FLAVOR = "production"

/**
 * Declares the `environment` dimension with its one flavor, `production`, so variants are named
 * `productionDebug` / `productionRelease`. With a single backend there is nothing to switch between;
 * the dimension is here so a second environment is a flavor away rather than a rename of every
 * variant, task and run configuration, and so `:baselineprofile` can mirror it by name.
 *
 * Per-app values (the API base URL) are layered on in each app's build file, on top of the flavor
 * created here.
 */
internal fun configureFlavors(extension: ApplicationExtension) {
    extension.apply {
        flavorDimensions += ENVIRONMENT_DIMENSION
        productFlavors {
            create(PRODUCTION_FLAVOR) {
                dimension = ENVIRONMENT_DIMENSION
            }
        }
    }
}

/**
 * The gitignored `secret.properties` at the root of the Gradle build, or nothing when it isn't there.
 * The public build needs none of it: forks, contributors and CI for pull requests build without one.
 */
fun Project.loadSecrets(): Properties = Properties().apply {
    rootProject.file("secret.properties")
        .takeIf { it.exists() }
        ?.inputStream()
        ?.use { load(it) }
}

/** [key], or [default] when it is absent or blank: a key left empty is a key nobody filled in. */
operator fun Properties.invoke(key: String, default: String = ""): String =
    getProperty(key)?.takeIf { it.isNotBlank() } ?: default
