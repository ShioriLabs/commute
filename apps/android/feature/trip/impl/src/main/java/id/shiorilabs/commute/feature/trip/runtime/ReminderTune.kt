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
 * A Maiden's Prayer, as Taiwan's garbage trucks play it, when the trip tells the rider to get ready
 * to get off. As media, which silent mode doesn't touch but the media volume does, and earbuds keep
 * to the rider; or as an alarm, for a rider asleep, which neither silent mode nor Do Not Disturb
 * hushes. It ducks whatever the rider is listening to while it plays.
 */
@Singleton
class ReminderTune @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {

    private val audio: AudioManager by lazy { context.getSystemService(AudioManager::class.java) }

    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null

    /** From the top: a second reminder while the first still plays starts it again, not over it. */
    @Synchronized
    fun play(alarm: Boolean) {
        stop()
        runCatching {
            val attributes = AudioAttributes.Builder()
                .setUsage(if (alarm) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val next = MediaPlayer.create(context, R.raw.reminder_maiden, attributes, AudioManager.AUDIO_SESSION_ID_GENERATE)
                ?: return
            player = next
            next.setOnCompletionListener { if (player === it) stop() }
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .build()
                .also(audio::requestAudioFocus)
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
        focus?.let(audio::abandonAudioFocusRequest)
        focus = null
    }
}
