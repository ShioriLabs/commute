package id.shiorilabs.commute.feature.trip

import android.content.Intent

/**
 * The trip's own log, kept on disk across rides and process deaths, for a field test to send on:
 * what logcat would say, without a computer, and from before logcat rotated it away.
 */
fun interface TripLogExport {

    /** A share sheet with a copy of the log, or `null` when nothing has been logged yet. */
    suspend fun share(): Intent?
}
