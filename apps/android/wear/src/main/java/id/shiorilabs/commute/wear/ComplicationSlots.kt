package id.shiorilabs.commute.wear

import android.content.Context
import androidx.core.content.edit

/** The station and direction one departures slot was set up to show. */
data class SlotChoice(val stationId: String, val directionKey: String)

/** What each departures slot on the watch face was set up to show, by the slot's id. */
class ComplicationSlots(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun get(complicationId: Int): SlotChoice? {
        val (stationId, directionKey) = prefs.getString(key(complicationId), null)?.split(SEPARATOR, limit = 2)
            ?.takeIf { it.size == 2 } ?: return null
        return SlotChoice(stationId, directionKey)
    }

    fun set(complicationId: Int, choice: SlotChoice) {
        prefs.edit { putString(key(complicationId), choice.stationId + SEPARATOR + choice.directionKey) }
    }

    fun clear(complicationId: Int) {
        prefs.edit { remove(key(complicationId)) }
    }

    private fun key(complicationId: Int) = "slot_$complicationId"

    private companion object {

        const val PREFS = "complication_slots"

        /** Neither a station id nor a direction key (`KCI:B|S`) holds a line break. */
        const val SEPARATOR = "\n"
    }
}
