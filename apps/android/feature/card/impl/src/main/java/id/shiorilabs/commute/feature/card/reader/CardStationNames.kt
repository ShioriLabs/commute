package id.shiorilabs.commute.feature.card.reader

import id.shiorilabs.commute.feature.station.data.StationDirectory
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** Where the snapshot sits in the app's assets; `./gradlew updateCardStationNames` rewrites it. */
internal const val CARD_STATION_NAMES_ASSET = "card/station_names.json"

/**
 * The names of the stations a card's entries point at, by the API's station id, for every reader:
 * a reader says which station, this says what it's called. The API's directory has the name as it is
 * now; [snapshot] is the directory as it was when the app was built, for a phone that has never
 * fetched it. Later sources win, so a rename shows as soon as the API has it.
 */
internal class CardStationNames(
    private val directory: StationDirectory,
    private val snapshot: () -> InputStream,
) {
    private val shipped: Map<String, String> by lazy { snapshot().use { parse(it.readBytes().decodeToString()) } }

    /**
     * The snapshot's names, then the held directory's over them (disk, however old), then a fetched
     * one's. A source that fails or has nothing leaves the names as they were.
     */
    val names: Flow<Map<String, String>> = flow {
        var names = shipped
        emit(names)
        directory.stored()?.let { held ->
            names = names + held.associate { it.id to it.name }
            emit(names)
        }
        directory.all().onRight { fetched ->
            names = names + fetched.associate { it.id to it.name }
            emit(names)
        }
    }.flowOn(Dispatchers.IO)

    private fun parse(text: String): Map<String, String> =
        Json.parseToJsonElement(text).jsonObject.mapValues { (_, name) -> (name as JsonPrimitive).content }
}
