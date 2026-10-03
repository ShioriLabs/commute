package id.shiorilabs.commute.feature.line

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import id.shiorilabs.commute.core.model.models.LineDetail as LineDetailDto

/** The app's own configuration (JsonModule): unknown keys are ignored. */
private val json = Json { ignoreUnknownKeys = true }

/**
 * A line as the live API sent it (captured 2026-10-03), decoded the way the app decodes it:
 * `line_bogor.json` (a trunk with a continuation and a ramp off its end), `line_cikarang.json` (a
 * trunk with a loop), `line_tangerang.json` (a trunk alone) and `line_tj_1.json` (one tail off the
 * trunk's end, ramps elsewhere).
 */
internal fun lineFixture(name: String): LineDetailDto {
    val body = checkNotNull(object {}.javaClass.getResource("/$name")).readText()
    return json.decodeFromJsonElement(json.parseToJsonElement(body).jsonObject.getValue("data"))
}
