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
 * @property debug A debug build: settings show the switches for trying the app out.
 * @property webBaseUrl Root of the web app, without a trailing slash: where the map's tiles and tap
 *   targets are served from. Production unless a debug build was pointed at a local web server.
 */
data class Environment(
    val apiBaseUrl: String,
    val appVersion: String,
    val debug: Boolean = false,
    val webBaseUrl: String = "https://commute.shiorilabs.id",
)
