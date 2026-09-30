import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.tasks.KotlinCompilationTask

class KotlinSerializationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("org.jetbrains.kotlin.plugin.serialization")

        // Set on the compile tasks rather than a project extension so the same plugin serves both
        // Android modules and the pure Kotlin ones.
        tasks.withType<KotlinCompilationTask<*>>().configureEach {
            compilerOptions {
                optIn.add("kotlinx.serialization.ExperimentalSerializationApi")
            }
        }
    }
}
