package id.shiorilabs.commute.wear

import android.content.ComponentName
import android.content.Context
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ColorRamp
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationText
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountDownTimeReference
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.wearable.WearTrip
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * The running trip on the watch face, "OTW": the trip screen's big figure, minutes counting down on
 * their own, and how far along the trip is, in its lines' colours on a ranged slot. Asked again
 * whenever the phone's trip changes; with none running, the app's mark.
 */
class TripComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val trip = WearTripRepository(this).current()
        val content = tripComplication(trip, Instant.now())
        return if (trip == null || content == null) idle(request.complicationType) else running(request.complicationType, trip, content)
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        val text = plain(getString(R.string.complication_otw_preview_short))
        val title = plain(getString(R.string.complication_otw_preview_title))
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text, title).setMonochromaticImage(icon(CopyR.drawable.ic_stat_alight)).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(plain(getString(R.string.complication_otw_preview_text)), title)
                .setTitle(title)
                .setMonochromaticImage(icon(CopyR.drawable.ic_stat_alight))
                .build()
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(PREVIEW_PROGRESS, 0f, 1f, title)
                .setText(text)
                .setMonochromaticImage(icon(CopyR.drawable.ic_stat_alight))
                .build()
            else -> null
        }
    }

    private fun running(type: ComplicationType, trip: WearTrip, content: TripComplication): ComplicationData? {
        val copy = WatchCopy(resources, trip.lines)
        val description = plain(copy.title(content.headline))
        val image = icon(if (content.boarding) CopyR.drawable.ic_stat_boarding else CopyR.drawable.ic_stat_alight)
        val short = content.countdownTo?.let(::countdown) ?: plain(shortFigure(content))
        val tap = TripOngoing.openApp(this)
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(short, description)
                .setMonochromaticImage(image)
                .setTapAction(tap)
                .build()
            ComplicationType.LONG_TEXT -> {
                val detail = copy.heroDetail(content.headline, content.hero)
                val text = content.countdownTo
                    ?.let { countdown(it, template = listOf(COUNTDOWN, detail).filter(String::isNotEmpty).joinToString(WatchCopy.SEPARATOR)) }
                    ?: plain(copy.summary(trip.state, content.headline, Instant.now()).ifEmpty { copy.title(content.headline) })
                LongTextComplicationData.Builder(text, description)
                    .setTitle(description)
                    .setMonochromaticImage(image)
                    .setTapAction(tap)
                    .build()
            }
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(content.progress, 0f, 1f, description)
                .setText(short)
                .setMonochromaticImage(image)
                // A colour ramp needs two stops: one ride is its colour throughout.
                .setColorRamp(ColorRamp(content.colors.ifEmpty { listOf(ACCENT) }.let { if (it.size == 1) it + it else it }.toIntArray(), false))
                .setTapAction(tap)
                .build()
            else -> null
        }
    }

    private fun idle(type: ComplicationType): ComplicationData? {
        val description = plain(getString(R.string.idle_title))
        val image = icon(R.drawable.ic_launcher_monochrome)
        val tap = TripOngoing.openApp(this)
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(plain(getString(R.string.complication_otw)), description)
                .setMonochromaticImage(image)
                .setTapAction(tap)
                .build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(description, description)
                .setMonochromaticImage(image)
                .setTapAction(tap)
                .build()
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(0f, 0f, 1f, description)
                .setText(plain(getString(R.string.complication_otw)))
                .setMonochromaticImage(image)
                .setTapAction(tap)
                .build()
            else -> null
        }
    }

    /** The figure in a few characters, when there are no minutes to count: "3 st", "18.50", "Turun". */
    private fun shortFigure(content: TripComplication): String = when (val hero = content.hero) {
        is Hero.StopsLeft -> getString(if (hero.bus) R.string.complication_haltes else R.string.complication_stations, hero.stops)
        is Hero.Clock -> formatClock(hero.at)
        is Hero.Minutes -> resources.getString(R.string.trip_minutes, hero.minutes)
        Hero.Place -> getString(
            when (content.headline) {
                is Headline.Board, is Headline.Change -> R.string.complication_board
                is Headline.Arrived -> R.string.complication_arrived
                else -> R.string.complication_alight
            },
        )
    }

    private fun icon(drawable: Int) = MonochromaticImage.Builder(Icon.createWithResource(this, drawable)).build()

    companion object {

        /** Asks every "OTW" slot to show the trip again: called as the phone's trip changes. */
        fun update(context: Context) {
            ComplicationDataSourceUpdateRequester
                .create(context, ComponentName(context, TripComplicationService::class.java))
                .requestUpdateAll()
        }

        private const val PREVIEW_PROGRESS = 0.4f
        private const val COUNTDOWN = "^1"
        private val ACCENT = 0xFFF55875.toInt()
    }
}

internal fun plain(text: CharSequence): ComplicationText = PlainComplicationText.Builder(text).build()

/** Minutes to [at], counted down by the watch face itself: "12m", in [template] where `^1` stands. */
internal fun countdown(at: Instant, template: String? = null): ComplicationText =
    TimeDifferenceComplicationText.Builder(TimeDifferenceStyle.SHORT_SINGLE_UNIT, CountDownTimeReference(at))
        .setMinimumTimeUnit(TimeUnit.MINUTES)
        .apply { if (template != null) setText(template) }
        .build()
