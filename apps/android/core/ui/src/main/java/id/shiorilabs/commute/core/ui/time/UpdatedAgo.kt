package id.shiorilabs.commute.core.ui.time

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.ui.R
import java.time.Duration
import java.time.Instant

/** How long ago something was last confirmed, in the unit a rider reads it in. */
sealed interface UpdatedAgo {

    data object JustNow : UpdatedAgo

    data class Minutes(val count: Long) : UpdatedAgo

    data class Hours(val count: Long) : UpdatedAgo

    data class Days(val count: Long) : UpdatedAgo
}

/**
 * [updatedAt] relative to [now]: just now under a minute (a clock a little behind the server's
 * included), then whole minutes, hours and days, each rounded down so it never reads newer than
 * it is.
 */
fun updatedAgo(updatedAt: Instant, now: Instant): UpdatedAgo {
    val age = Duration.between(updatedAt, now)
    return when {
        age < Duration.ofMinutes(1) -> UpdatedAgo.JustNow
        age < Duration.ofHours(1) -> UpdatedAgo.Minutes(age.toMinutes())
        age < Duration.ofDays(1) -> UpdatedAgo.Hours(age.toHours())
        else -> UpdatedAgo.Days(age.toDays())
    }
}

/**
 * "Terakhir diperbarui 5 menit lalu": the line under an answer shown offline, so nothing passes
 * itself off as live. Recomputed on the screen's clock.
 */
@Composable
fun updatedAgoText(updatedAt: Instant): String {
    val now = rememberJakartaNow().atZone(JAKARTA).toInstant()
    return when (val ago = updatedAgo(updatedAt, now)) {
        UpdatedAgo.JustNow -> stringResource(R.string.core_ui_updated_just_now)
        is UpdatedAgo.Minutes -> stringResource(R.string.core_ui_updated_minutes_ago, ago.count)
        is UpdatedAgo.Hours -> stringResource(R.string.core_ui_updated_hours_ago, ago.count)
        is UpdatedAgo.Days -> stringResource(R.string.core_ui_updated_days_ago, ago.count)
    }
}
