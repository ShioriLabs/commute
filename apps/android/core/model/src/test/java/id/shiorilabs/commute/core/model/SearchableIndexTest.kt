package id.shiorilabs.commute.core.model

import id.shiorilabs.commute.core.model.models.SearchableHub
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.SearchableLineEntry
import id.shiorilabs.commute.core.model.models.SearchableStation
import id.shiorilabs.commute.core.model.models.SearchableStationOperator
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes a response captured from `GET /_internal/searchables` (trimmed to one entry of each
 * shape) into the generated models. The models are generated, so what this guards is the pairing:
 * that the snapshot they come from still describes what the API actually sends.
 */
class SearchableIndexTest {

    private val json = Json { ignoreUnknownKeys = true }

    private val index: SearchableIndex by lazy {
        val body = checkNotNull(javaClass.getResource("/searchables.json")).readText()
        json.decodeFromJsonElement(json.parseToJsonElement(body).jsonObject.getValue("data"))
    }

    @Test
    fun `each entry decodes to the variant its type names`() {
        assertEquals(
            listOf("STATION", "STATION", "STATION", "HUB", "LINE"),
            index.items.map { item ->
                when (item) {
                    is SearchableStation -> "STATION"
                    is SearchableHub -> "HUB"
                    is SearchableLineEntry -> "LINE"
                }
            },
        )
    }

    @Test
    fun `a station carries its operator, line keys and score`() {
        val manggarai = index.items.filterIsInstance<SearchableStation>().first()

        assertEquals("Manggarai", manggarai.title)
        assertEquals(SearchableStationOperator.KCI, manggarai.`operator`)
        assertEquals(listOf("KCI:A", "KCI:B", "KCI:C"), manggarai.lineKeys)
        assertEquals("KCI-MRI", manggarai.`data`?.get("station-id"))
        assertEquals(95.0, manggarai.score)
    }

    @Test
    fun `an omitted score decodes as null`() {
        assertNull(index.items.filterIsInstance<SearchableLineEntry>().first().score)
    }

    @Test
    fun `every line key an entry carries resolves in the dictionary`() {
        val keys = index.items.flatMap { item ->
            when (item) {
                is SearchableStation -> item.lineKeys
                is SearchableHub -> item.lineKeys
                is SearchableLineEntry -> listOf(item.lineKey)
            }
        }

        assertTrue(keys.isNotEmpty())
        assertTrue(keys.all { it in index.lines })
    }
}
