package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.feature.trip.R
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A Maiden's Prayer, as Taiwan's garbage trucks play it, when a trip with a reminder tells the
 * rider to get ready to get off. It plays as an alarm, so silent mode and Do Not Disturb don't
 * hush it, and ducks whatever the rider is listening to while it does.
 */
@Singleton
class ReminderTune @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {

    private val audio: AudioManager by lazy { context.getSystemService(AudioManager::class.java) }

    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attributes)
        .build()

    private var player: MediaPlayer? = null

    /** From the top: a second reminder while the first still plays starts it again, not over it. */
    @Synchronized
    fun play() {
        stop()
        runCatching {
            val next = MediaPlayer.create(context, R.raw.reminder_maiden, attributes, AudioManager.AUDIO_SESSION_ID_GENERATE)
                ?: return
            player = next
            next.setOnCompletionListener { if (player === it) stop() }
            audio.requestAudioFocus(focus)
            next.start()
        }.onFailure { stop() }
    }

    /** The rider's off, or up: the tune stops where it is. */
    @Synchronized
    fun stop() {
        val playing = player ?: return
        player = null
        runCatching { playing.stop() }
        playing.release()
        audio.abandonAudioFocusRequest(focus)
    }
}
