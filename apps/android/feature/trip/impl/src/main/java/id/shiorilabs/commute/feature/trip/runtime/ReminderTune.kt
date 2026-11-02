package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.feature.trip.R
import java.time.Duration
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.pow

/** How long an alarm's tune takes to climb to full: a short hop's "siap-siap" leaves little more. */
internal val RAMP: Duration = Duration.ofSeconds(60)

/** Where an alarm's tune starts, against full. */
private const val RAMP_START = 0.1f

private const val RAMP_STEP_MILLIS = 500L

/**
 * An alarm's tune [elapsed] into its climb. Evenly in loudness, not in amplitude, which would sound
 * near enough full by halfway.
 */
internal fun wakeVolume(elapsed: Duration): Float =
    if (elapsed >= RAMP) 1f else RAMP_START.pow(1f - elapsed.toMillis().toFloat() / RAMP.toMillis())

/**
 * A Maiden's Prayer, as Taiwan's garbage trucks play it, when the trip tells the rider to get ready
 * to get off. As media, which silent mode doesn't touch but the media volume does, and earbuds keep
 * to the rider, once through; or as an alarm, for a rider asleep, which neither silent mode nor Do
 * Not Disturb hushes, starting quiet and climbing over and over until they're up or [RING_FOR] has
 * passed. It ducks whatever the rider is listening to while it plays. On a bus it's Clair de Lune
 * instead.
 */
@Singleton
class ReminderTune @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {

    private val audio: AudioManager by lazy { context.getSystemService(AudioManager::class.java) }

    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null

    private val handler = Handler(Looper.getMainLooper())
    private val climb = Runnable { climb() }
    private var alarmStartedAt = 0L
    private var full = false

    /**
     * From the top: a second reminder while the first still plays starts it again, not over it. An
     * alarm [atStop] has no time left to climb, so it starts at full.
     */
    @Synchronized
    fun play(alarm: Boolean, bus: Boolean = false, atStop: Boolean = false) {
        stop()
        runCatching {
            val attributes = AudioAttributes.Builder()
                .setUsage(if (alarm) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val tune = if (bus) R.raw.reminder_clair_de_lune else R.raw.reminder_maiden
            val next = MediaPlayer.create(context, tune, attributes, AudioManager.AUDIO_SESSION_ID_GENERATE)
                ?: return
            player = next
            next.setOnCompletionListener { if (player === it) stop() }
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .build()
                .also(audio::requestAudioFocus)
            if (alarm) {
                next.isLooping = true
                alarmStartedAt = SystemClock.elapsedRealtime()
                full = atStop
                climb()
            }
            next.start()
        }.onFailure { stop() }
    }

    /** At the stop: a tune still climbing goes straight to full. */
    @Synchronized
    fun louden() {
        full = true
        player?.setVolume(1f, 1f)
    }

    /** One step up an alarm's climb, then a wait for the next, or at full, for [RING_FOR] to pass. */
    @Synchronized
    private fun climb() {
        val playing = player ?: return
        val elapsed = Duration.ofMillis(SystemClock.elapsedRealtime() - alarmStartedAt)
        if (elapsed >= RING_FOR) {
            stop()
            return
        }
        val volume = if (full) 1f else wakeVolume(elapsed)
        playing.setVolume(volume, volume)
        handler.postDelayed(climb, if (volume < 1f) RAMP_STEP_MILLIS else RING_FOR.minus(elapsed).toMillis())
    }

    /** The rider's off, or up: the tune stops where it is. */
    @Synchronized
    fun stop() {
        handler.removeCallbacks(climb)
        val playing = player ?: return
        player = null
        runCatching { playing.stop() }
        playing.release()
        focus?.let(audio::abandonAudioFocusRequest)
        focus = null
    }
}
