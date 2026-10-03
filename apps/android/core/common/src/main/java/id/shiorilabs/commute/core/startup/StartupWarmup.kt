package id.shiorilabs.commute.core.startup

/**
 * Work that reads what the first screen will need into memory while the app starts: a feature's
 * `:impl` binds one `@IntoSet`, and the application runs them all as the process starts, off the
 * main thread and in parallel with the splash, so the first frame is built from memory rather than
 * waiting on the disk.
 *
 * Only loads what is already stored. Anything stale may start refreshing, but [warm] need not wait
 * for the network to return, and a failure is never more than a slower first frame.
 */
fun interface StartupWarmup {

    suspend fun warm()
}
