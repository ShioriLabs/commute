package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.feature.trip.R
import id.shiorilabs.commute.feature.trip.runtime.MotionLive
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** What "Kecepatan IMU" has to show, or `null` with the switch off. */
internal sealed interface MotionStripState {

    /** On, but no train is being ridden: the sensors aren't running. */
    data object Waiting : MotionStripState

    /** This phone lacks one of the sensors it needs. */
    data object Unavailable : MotionStripState

    /**
     * The satellites' last speed and how old it is, the sensors' speed and forward acceleration
     * (positive pulling away, negative braking), in km/h and m/s².
     */
    data class Reading(
        val gpsKmh: Int?,
        val gpsAgeS: Long?,
        val imuKmh: Int?,
        val accelMps2: Double?,
        val aligned: Boolean,
        val still: Boolean,
    ) : MotionStripState
}

internal fun motionStrip(enabled: Boolean, live: MotionLive?): MotionStripState? = when {
    !enabled -> null
    live == null -> MotionStripState.Waiting
    live.unavailable || live.readout == null -> MotionStripState.Unavailable
    else -> live.readout.let { readout ->
        MotionStripState.Reading(
            gpsKmh = readout.lastGnssSpeedMps?.let { (it * KMH_PER_MPS).roundToInt() },
            gpsAgeS = readout.lastGnssAtNanos?.let { ((live.nowNanos - it) / 1e9).coerceAtLeast(0.0).roundToLong() },
            imuKmh = readout.imuSpeedMps?.let { (it * KMH_PER_MPS).roundToInt() },
            accelMps2 = readout.aLongMps2,
            aligned = readout.aligned,
            still = readout.still,
        )
    }
}

private const val KMH_PER_MPS = 3.6

/** The strip's height above the bottom inset, which the page keeps clear under its last row. */
internal val MotionStripHeight: Dp = 41.dp

private val Label = Color(0xFF64748B)
private val Value = Color(0xFF0F172A)

/**
 * "Kecepatan IMU" (Experimental): the satellites' speed beside the motion sensors' and the forward
 * acceleration, in one line over the bottom of the trip page, to watch them agree (or not) on a
 * ride, and through a tunnel where only the sensors have anything to say.
 */
@Composable
internal fun MotionStrip(state: MotionStripState, bottomInset: Dp, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(bottom = bottomInset),
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFE2E8F0)))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(MotionStripHeight - 1.dp)
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when (state) {
                MotionStripState.Waiting -> Cell(text = stringResource(R.string.trip_motion_waiting))
                MotionStripState.Unavailable -> Cell(text = stringResource(R.string.trip_motion_unavailable))
                is MotionStripState.Reading -> {
                    val none = stringResource(R.string.trip_motion_none)
                    val gps = state.gpsKmh?.let { kmh ->
                        val speed = stringResource(R.string.trip_motion_kmh, kmh)
                        state.gpsAgeS?.let { stringResource(R.string.trip_motion_aged, speed, it) } ?: speed
                    } ?: none
                    Cell(label = stringResource(R.string.trip_motion_gps), text = gps)
                    if (!state.aligned) {
                        Cell(label = stringResource(R.string.trip_motion_imu), text = stringResource(R.string.trip_motion_aligning))
                    } else {
                        val imu = state.imuKmh?.let { stringResource(R.string.trip_motion_kmh, it) } ?: none
                        Cell(
                            label = stringResource(R.string.trip_motion_imu),
                            text = if (state.still) stringResource(R.string.trip_motion_still, imu) else imu,
                        )
                        Cell(text = state.accelMps2?.let { stringResource(R.string.trip_motion_accel, formatAccel(it)) } ?: none)
                    }
                }
            }
        }
    }
}

/** Signed, two places, the Indonesian way: "+0,82", "−1,03". */
private fun formatAccel(value: Double): String =
    String.format(Locale.forLanguageTag("id"), "%+.2f", value).replace('-', '−')

@Composable
private fun Cell(text: String, label: String? = null) {
    Text(
        text = buildAnnotatedString {
            if (label != null) {
                withStyle(SpanStyle(color = Label)) { append(label) }
                append(' ')
            }
            append(text)
        },
        style = MaterialTheme.typography.labelMedium.merge(fontFeatureSettings = "tnum"),
        color = Value,
        maxLines = 1,
    )
}
