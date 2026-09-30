import com.android.build.api.dsl.ApplicationExtension
import id.shiorilabs.commute.buildlogic.configureAndroidCompose
import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.application")

        extensions.configure<ApplicationExtension> {
            compileSdk {
                version = release(37)
            }

            defaultConfig {
                minSdk = 31
                targetSdk = 37
            }

            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_11
                targetCompatibility = JavaVersion.VERSION_11
            }

            buildFeatures {
                buildConfig = true
            }

            configureAndroidCompose(this)
        }
    }
}
