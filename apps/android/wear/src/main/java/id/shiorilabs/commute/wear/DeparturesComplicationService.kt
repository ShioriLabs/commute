package id.shiorilabs.commute.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationDataTimeline
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingTimelineComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.TimeInterval
import androidx.wear.watchface.complications.datasource.TimelineEntry
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.wearable.WearDirection
import id.shiorilabs.commute.core.wearable.WearStation
import java.time.Instant

/**
 * "Keberangkatan" on the watch face: the next trains from a saved station, the way the slot was set
 * up to look. The next few hours are handed over as a timeline, so the slot moves on as each train
 * leaves without the app waking; it is asked again hourly, and as the phone sends new boards.
 */
class DeparturesComplicationService : SuspendingTimelineComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationDataTimeline? {
        val type = request.complicationType
        val id = request.complicationInstanceId
        val now = Instant.now()
        val phone = PhoneLink(this)
        val choice = ComplicationSlots(this).get(id) ?: return single(unset(type, id))
        val station = SavedStationsStore(this).station(choice.stationId)
        if (station == null) {
            // Set up before the phone's copy landed, or since unsaved: ask, and offer setup again.
            phone.requestSavedSync(choice.stationId)
            return single(unset(type, id))
        }
        if (station.isStale(now)) phone.requestSavedSync(null)
        val direction = station.directions.firstOrNull { it.key == choice.directionKey } ?: return single(unset(type, id))
        val tap = OpenStationReceiver.tap(this, station.id)
        val frames = direction.departureFrames(now)
        if (frames.isEmpty()) return single(noTrains(type, station, direction, tap))
        val first = departures(type, station, direction, frames.first(), tap) ?: return null
        val entries = frames.mapNotNull { frame ->
            departures(type, station, direction, frame, tap)?.let { TimelineEntry(TimeInterval(frame.from, frame.until), it) }
        }
        return ComplicationDataTimeline(first, entries)
    }

    override fun onComplicationDeactivated(complicationInstanceId: Int) {
        ComplicationSlots(this).clear(complicationInstanceId)
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        val title = plain(getString(R.string.complication_departures_preview_title))
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(plain(getString(R.string.complication_departures_preview_short)), title)
                .setTitle(plain(getString(R.string.complication_departures_preview_label)))
                .build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(plain(getString(R.string.complication_departures_preview_text)), title)
                .setTitle(title)
                .build()
            else -> null
        }
    }

    /** The trains [frame] shows: the first counting down once near, or at its time; the rest at theirs. */
    private fun departures(type: ComplicationType, station: WearStation, direction: WearDirection, frame: DepartureFrame, tap: PendingIntent): ComplicationData? {
        val label = shortLabel(direction.label)
        val toward = plain(getString(R.string.complication_toward, station.name, label))
        val first = frame.next.first()
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(if (frame.countdown) countdown(first) else plain(formatClock(first)), toward)
                .setTitle(plain(label))
                .setTapAction(tap)
                .build()
            ComplicationType.LONG_TEXT -> {
                val rest = frame.next.drop(1).map(::formatClock)
                val text = if (frame.countdown) {
                    countdown(first, template = (listOf(COUNTDOWN) + rest).joinToString(WatchCopy.SEPARATOR))
                } else {
                    plain(frame.next.joinToString(WatchCopy.SEPARATOR, transform = ::formatClock))
                }
                LongTextComplicationData.Builder(text, toward).setTitle(toward).setTapAction(tap).build()
            }
            else -> null
        }
    }

    /** The direction runs no more trains the timetables know of. */
    private fun noTrains(type: ComplicationType, station: WearStation, direction: WearDirection, tap: PendingIntent): ComplicationData? {
        val label = shortLabel(direction.label)
        val toward = plain(getString(R.string.complication_toward, station.name, label))
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(plain(DASH), toward).setTitle(plain(label)).setTapAction(tap).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(plain(getString(R.string.complication_no_trains)), toward)
                .setTitle(toward)
                .setTapAction(tap)
                .build()
            else -> null
        }
    }

    /** Not set up, or its station gone: a dash, and a tap sets it up again. */
    private fun unset(type: ComplicationType, complicationId: Int): ComplicationData? {
        val description = plain(getString(R.string.complication_departures_unset))
        val tap = PendingIntent.getActivity(
            this,
            complicationId,
            Intent(this, DeparturesConfigActivity::class.java)
                .putExtra(ComplicationDataSourceService.EXTRA_CONFIG_COMPLICATION_ID, complicationId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(plain(DASH), description).setTapAction(tap).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(description, description).setTapAction(tap).build()
            else -> null
        }
    }

    private fun single(data: ComplicationData?): ComplicationDataTimeline? = data?.let { ComplicationDataTimeline(it, emptyList()) }

    companion object {

        private const val COUNTDOWN = "^1"
        private const val DASH = "—"

        /** Asks every departures slot again: the phone sent new boards. */
        fun updateAll(context: Context) {
            requester(context).requestUpdateAll()
        }

        /** Asks the one slot just set up. */
        fun update(context: Context, complicationId: Int) {
            requester(context).requestUpdate(complicationId)
        }

        private fun requester(context: Context) =
            ComplicationDataSourceUpdateRequester.create(context, ComponentName(context, DeparturesComplicationService::class.java))
    }
}
