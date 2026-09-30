import com.android.build.api.dsl.LibraryExtension
import id.shiorilabs.commute.buildlogic.configureAndroidCompose
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.apply
import org.gradle.kotlin.dsl.configure

class AndroidLibraryComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        apply(plugin = "commute.android.library")

        extensions.configure<LibraryExtension> {
            configureAndroidCompose(this)
        }
    }
}
