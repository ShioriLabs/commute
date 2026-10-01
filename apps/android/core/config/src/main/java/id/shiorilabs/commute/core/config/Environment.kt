package id.shiorilabs.commute.core.config

/**
 * Build-time configuration.
 *
 * This is a plain value with no `BuildConfig` coupling — `:app` resolves the concrete instance from
 * its `BuildConfig` and provides it through Hilt, so downward modules depend only on this type,
 * never on `:app`'s generated `BuildConfig`.
 *
 * @property apiBaseUrl Root of the Commute API, without a trailing slash. Production unless a debug
 *   build was pointed at a local API.
 * @property appVersion The app's `versionName`, sent with every request.
 */
data class Environment(
    val apiBaseUrl: String,
    val appVersion: String,
)
