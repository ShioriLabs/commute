package id.shiorilabs.commute.feature.trip

import android.content.Intent

/**
 * "Kecepatan IMU"'s recordings: the motion sensors at 50 Hz, the fixes and the estimator for each
 * train leg ridden with it on, kept on disk to send on beside the trip log.
 */
fun interface SensorDataExport {

    /** A share sheet with every kept recording, or `null` when there's none yet. */
    suspend fun share(): Intent?
}
