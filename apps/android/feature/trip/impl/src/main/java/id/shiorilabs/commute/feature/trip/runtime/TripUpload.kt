package id.shiorilabs.commute.feature.trip.runtime

import android.content.Context
import com.github.luben.zstd.ZstdOutputStream
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.projectOnPath
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.core.type.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.floor
import kotlin.math.roundToLong

/** How an upload from the trip's last page went. */
enum class UploadResult {
    /** Stored, for the week the API keeps it. */
    SENT,

    /** The API isn't taking uploads just now (`config:trip-uploads` isn't `open`). */
    CLOSED,

    /** Nothing left to send: the trip's lines are gone from the log, or none were inside the window. */
    EMPTY,

    /** No network, or an answer other than the two above. */
    FAILED,
}

/**
 * Sends one finished trip's log, endpoints blurred ([TripUploadRedactor]), to the API's anonymous
 * `uploads/trips`: the rider's own tap on the trip's last page, after the sheet saying what goes.
 */
@Singleton
class TripUploader @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val log: FileTripLog,
    private val service: CommuteService,
    private val environment: Environment,
    private val clock: Clock,
) {

    private val random = SecureRandom()

    suspend fun upload(finished: FinishedTrip): UploadResult {
        val body = withContext(Dispatchers.IO) {
            // Drawn fresh each time, so the cut can't be read back off the first stop shown.
            val trims = TripUploadRedactor.Trims(start = 1 + random.nextInt(2), end = 1 + random.nextInt(2))
            val lines = TripUploadRedactor.redact(log.lines(), finished, trims) ?: return@withContext null
            val bytes = ByteArrayOutputStream()
            ZstdOutputStream(bytes, COMPRESSION_LEVEL).use { out ->
                out.write(line(STAMP.format(clock.instant()), "device", deviceFacts(context)).encodeToByteArray())
                lines.forEach { out.write(it.encodeToByteArray()) }
            }
            bytes.toByteArray()
        } ?: return UploadResult.EMPTY

        return try {
            service.uploadTripLog(body, environment.appVersion)
            UploadResult.SENT
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            if (e.status == HTTP_UNAVAILABLE) UploadResult.CLOSED else UploadResult.FAILED
        } catch (_: Exception) {
            UploadResult.FAILED
        }
    }

    private companion object {
        /** What the API answers while `config:trip-uploads` isn't `open`. */
        const val HTTP_UNAVAILABLE = 503

        /** As the shared log: a log of repeated keys shrinks a lot even at this. */
        const val COMPRESSION_LEVEL = 3
    }
}

/**
 * One trip's lines out of the rolling trip log, with its ends taken off, Strava's privacy zones
 * for a train: what's sent starts a stop or two after boarding and ends a stop or two before
 * getting off, so it shows the line ridden but not where from or to.
 *
 * Stops are counted across the whole trip, changes and all, as one run: the transfer station is
 * the same stop at the end of one ride and the start of the next. A trip that ended early ends
 * where the rider got to.
 */
internal object TripUploadRedactor {

    /** Short of this many stops end to end, nothing is offered: there'd be nothing left between the cuts. */
    const val MIN_HOPS = 5

    /** A fix further than this from the part of the route kept is dropped: the rider has left it. */
    const val OFF_TRACK_M = 300.0

    /** What's ridden and sent: only lines that say where the trip stood, and the motion beside them. */
    private val KEPT_EVENTS = setOf("fix", "tick", "rider", "location", "resumed", "imu", "mark")

    /** A mark's board facts that would count down to the alighting stop. */
    private val DROPPED_MARK_FIELDS = setOf("boardStopsLeft", "boardMinutesLeft")

    /** How many stops come off each end, 1 or 2. */
    data class Trims(val start: Int, val end: Int)

    private val json = Json

    /** Whether there's enough trip for anything to be left once both ends are cut, as far as it can be cut. */
    fun eligible(finished: FinishedTrip): Boolean = endHop(finished) >= MIN_HOPS

    /**
     * [lines], the trip log as stored, down to [finished]'s own trip with its ends cut by [trims]:
     * a `plan` line naming what's left of the route, then the kept events. `null` when the trip's
     * lines aren't in the log any more or none fall inside what's kept.
     */
    fun redact(lines: List<String>, finished: FinishedTrip, trims: Trims): List<String>? {
        if (!eligible(finished)) return null
        val plan = finished.trip.plan
        val window = Window(plan, from = trims.start, to = endHop(finished) - trims.end)
        val events = slice(lines.mapNotNull(::parse), finished.trip.origin.journeyKey) ?: return null

        val kept = mutableListOf<String>()
        // Where the trip stood as of the last line that said: lines without a place go by it.
        var at: Placed? = null
        for (event in events) {
            val name = event["ev"]?.jsonPrimitive?.contentOrNull ?: continue
            val leg = event["leg"]?.jsonPrimitive?.intOrNull
            val pos = event["pos"]?.jsonPrimitive?.doubleOrNull
            if (leg != null && pos != null) at = window.place(leg, pos)
            val placed = at ?: continue
            if (name !in KEPT_EVENTS || !placed.visible) continue
            if (name == "fix" && !window.onTrack(event)) continue
            kept += rewrite(event, name, placed, window).toString() + "\n"
        }
        if (kept.isEmpty()) return null
        val stamp = events.first()["t"]?.jsonPrimitive?.contentOrNull ?: return null
        return listOf(window.planLine(stamp)) + kept
    }

    /**
     * The trip's last stop, counted from its first: the destination when it got there, else as far
     * as the rider got.
     */
    private fun endHop(finished: FinishedTrip): Int {
        val plan = finished.trip.plan
        val offsets = offsets(plan)
        val total = plan.rideIndices.sumOf { plan.ride(it).lastIndex }
        if (finished.reason == FinishReason.ARRIVED) return total
        val state: TripState = finished.trip.state
        val offset = offsets[state.legIndex] ?: return 0
        return floor(offset + maxOf(state.position, state.confirmedPosition)).toInt().coerceIn(0, total)
    }

    /** Each ride's first stop, counted across the whole trip, by its index into the plan's legs. */
    private fun offsets(plan: TripPlan): Map<Int, Int> {
        var run = 0
        return plan.rideIndices.associateWith { index -> run.also { run += plan.ride(index).lastIndex } }
    }

    private fun parse(line: String): JsonObject? = runCatching { json.parseToJsonElement(line) as? JsonObject }.getOrNull()

    /**
     * From [journey]'s last `started` to its last `finished`, both included. When the log has
     * rotated past the start, from just after the trip before ended.
     */
    private fun slice(events: List<JsonObject>, journey: String): List<JsonObject>? {
        fun JsonObject.isEvent(name: String) = this["ev"]?.jsonPrimitive?.contentOrNull == name
        fun JsonObject.isOf(journey: String) = this["journey"]?.jsonPrimitive?.contentOrNull == journey

        val end = events.indexOfLast { it.isEvent("finished") && it.isOf(journey) }
        if (end < 0) return null
        var start = 0
        for (i in end - 1 downTo 0) {
            val event = events[i]
            if (event.isEvent("started") && event.isOf(journey)) {
                start = i
                break
            }
            if (event.isEvent("finished")) {
                start = i + 1
                break
            }
        }
        return events.subList(start, end + 1)
    }

    /** Leg and stop position as sent, and whether that's inside what's kept. */
    private data class Placed(val visible: Boolean, val leg: Int, val shift: Int)

    private fun rewrite(event: JsonObject, name: String, placed: Placed, window: Window): JsonObject = buildJsonObject {
        event.forEach { (key, value) ->
            when {
                key == "journey" -> Unit
                name == "mark" && key in DROPPED_MARK_FIELDS -> Unit
                // A board saying the next stop is the one to get off at would tell where that is.
                name == "mark" && key == "boardLabel" -> put(key, JsonPrimitive(maskLabel(value)))
                key == "leg" && value is JsonPrimitive -> put(key, JsonPrimitive(window.renumbered(placed.leg)))
                (key == "pos" || key == "confirmed") && value is JsonPrimitive -> {
                    val shifted = (value.doubleOrNull ?: 0.0) - placed.shift
                    put(key, JsonPrimitive(round3(shifted.coerceAtLeast(0.0))))
                }
                else -> put(key, value)
            }
        }
    }

    private fun maskLabel(value: JsonElement): String? = when (val label = (value as? JsonPrimitive)?.contentOrNull) {
        "ALIGHT_NEXT" -> "NEXT"
        "ALIGHT_HERE" -> "AT"
        else -> label
    }

    private fun round3(value: Double): Double = (value * 1000).roundToLong() / 1000.0

    /**
     * The part of [plan] kept: stops [from] to [to], counted across the whole trip. A ride with no
     * hop inside it is left out altogether, the legs renumbered over what's left, so nothing says
     * how much came before.
     */
    private class Window(private val plan: TripPlan, private val from: Int, private val to: Int) {

        private val offsets = offsets(plan)

        /** Per kept ride (by leg index into the plan): its first and last stop kept. */
        private val visible: Map<Int, IntRange> = plan.rideIndices.mapNotNull { index ->
            val ride = plan.ride(index)
            val offset = offsets.getValue(index)
            val first = maxOf(0, from - offset)
            val last = minOf(ride.lastIndex, to - offset)
            if (last > first) index to first..last else null
        }.toMap()

        /** The kept legs, in order: the kept rides, and a walk only between two of them. */
        private val keptLegs: List<Int> = plan.legs.indices.filter { index ->
            when (plan.legs[index]) {
                is TripLeg.Ride -> index in visible
                is TripLeg.Transfer -> (index - 1) in visible && (index + 1) in visible
            }
        }

        private val newIndex: Map<Int, Int> = keptLegs.withIndex().associate { (new, old) -> old to new }

        /** The kept route's geometry, hop by hop, to hold fixes against. */
        private val paths: List<List<GeoPoint>> = keptLegs.flatMap { index ->
            when (val leg = plan.legs[index]) {
                is TripLeg.Ride -> {
                    val range = visible.getValue(index)
                    (range.first until range.last).mapNotNull { k ->
                        leg.hopPaths[k] ?: listOfNotNull(leg.stops[k].point, leg.stops[k + 1].point).takeIf { it.size == 2 }
                    }
                }
                is TripLeg.Transfer -> listOfNotNull(listOfNotNull(leg.from.point, leg.to.point).takeIf { it.size == 2 })
            }
        }

        fun place(leg: Int, pos: Double): Placed {
            val range = visible[leg] ?: return Placed(visible = false, leg = leg, shift = 0)
            return Placed(visible = pos >= range.first && pos <= range.last, leg = leg, shift = range.first)
        }

        fun renumbered(leg: Int): Int = newIndex.getValue(leg)

        /** Whether a fix lies by the kept route; one that can't be held against it doesn't. */
        fun onTrack(event: JsonObject): Boolean {
            val lat = event["lat"]?.jsonPrimitive?.doubleOrNull ?: return false
            val lon = event["lon"]?.jsonPrimitive?.doubleOrNull ?: return false
            val point = GeoPoint(lat, lon)
            return paths.any { projectOnPath(point, it).offTrackM <= OFF_TRACK_M }
        }

        /** The kept route, for the events' `leg` and `pos` to be read against. */
        fun planLine(stamp: String): String = buildJsonObject {
            put("t", JsonPrimitive(stamp))
            put("ev", JsonPrimitive("plan"))
            put(
                "legs",
                buildJsonArray {
                    keptLegs.forEach { index ->
                        when (val leg = plan.legs[index]) {
                            is TripLeg.Ride -> add(ride(leg, visible.getValue(index)))
                            is TripLeg.Transfer -> add(
                                buildJsonObject {
                                    put("type", JsonPrimitive("TRANSFER"))
                                    put("from", stop(leg.from))
                                    put("to", stop(leg.to))
                                    put("distanceM", JsonPrimitive(leg.distanceM))
                                    put("corridorLabel", JsonPrimitive(leg.corridorLabel))
                                },
                            )
                        }
                    }
                },
            )
        }.toString() + "\n"

        private fun ride(ride: TripLeg.Ride, range: IntRange): JsonObject = buildJsonObject {
            put("type", JsonPrimitive("RIDE"))
            put("line", JsonPrimitive(ride.line))
            put("operator", JsonPrimitive(ride.operator))
            put("tripId", JsonPrimitive(ride.tripId))
            // No headsigns: a ride to the end of its line would name where the rider got off.
            put("serviceLines", JsonArray(ride.serviceLines.map { JsonPrimitive(it.line) }))
            // Leaving or reaching a stop that's cut would tell which one it was.
            put("departureAt", if (range.first == 0) instant(ride.departureAt) else JsonNull)
            put("arrivalAt", if (range.last == ride.lastIndex) instant(ride.arrivalAt) else JsonNull)
            put("stops", JsonArray(ride.stops.subList(range.first, range.last + 1).map(::stop)))
        }

        private fun stop(stop: TripStop): JsonObject = buildJsonObject {
            put("id", JsonPrimitive(stop.id))
            put("name", JsonPrimitive(stop.name))
            put("scheduledAt", instant(stop.scheduledAt))
        }

        private fun instant(at: Instant?) = at?.let { JsonPrimitive(STAMP.format(it)) } ?: JsonNull
    }
}
