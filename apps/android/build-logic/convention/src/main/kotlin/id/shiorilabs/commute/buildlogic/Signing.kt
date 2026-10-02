package id.shiorilabs.commute.buildlogic

import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Project

/**
 * Signs debug builds with the `debug.keystore` checked in at the root of the Gradle build, and
 * release builds with the key `secret.properties` names, when it names one.
 *
 * **Debug.** Every machine and CI run signs with the same key, so a debug build from one replaces
 * a debug build from another in place, keeping its data, instead of failing to install over it.
 * The phone app and its Wear companion share it too, which is what lets them pair. It is the
 * standard debug keystore, credentials and all; it signs nothing anyone should trust.
 *
 * **Release.** The four `RELEASE_*` keys (see `secret.properties.example`) point at the upload key,
 * which lives in neither repository. Without all four the release build is left unsigned rather than
 * failing, so a fork or a pull request's CI still builds it.
 */
internal fun Project.configureSigning(extension: ApplicationExtension) {
    val secrets = loadSecrets()
    val release = listOf("RELEASE_STORE_FILE", "RELEASE_STORE_PASSWORD", "RELEASE_KEY_ALIAS", "RELEASE_KEY_PASSWORD")
        .associateWith { secrets(it) }
        .takeIf { keys -> keys.values.none { it.isEmpty() } }

    extension.apply {
        signingConfigs {
            getByName("debug") {
                storeFile = rootProject.file("debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
            if (release != null) {
                create("release") {
                    storeFile = rootProject.file(release.getValue("RELEASE_STORE_FILE"))
                    storePassword = release.getValue("RELEASE_STORE_PASSWORD")
                    keyAlias = release.getValue("RELEASE_KEY_ALIAS")
                    keyPassword = release.getValue("RELEASE_KEY_PASSWORD")
                }
            }
        }

        buildTypes {
            getByName("debug") {
                signingConfig = signingConfigs.getByName("debug")
            }
            if (release != null) {
                getByName("release") {
                    signingConfig = signingConfigs.getByName("release")
                }
            }
        }
    }
}
