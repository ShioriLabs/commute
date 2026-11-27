package id.shiorilabs.commute.feature.hub.domain

/*
 * The model behind a place hub's tile switcher, the web's `utils/hub-members.ts`, kept free of
 * Compose so it can be unit tested.
 *
 * A place hub (integrated or directional) is one place to a rider: one tile per operator and,
 * when that operator's halte is split by direction of travel, a pill per side.
 */

/** A hub's members of one operator, in API order. */
data class OperatorGroup(val operator: String, val members: List<HubMember>)

/** Members grouped by operator, both in API order. */
fun groupByOperator(members: List<HubMember>): List<OperatorGroup> =
    members.groupBy { it.operator }.map { (operator, group) -> OperatorGroup(operator, group) }

private val ArahSuffix = Regex("""\s+Arah\s+(Utara|Selatan|Timur|Barat)$""", RegexOption.IGNORE_CASE)

/** "Kali Grogol Arah Utara" -> "Utara"; null for an unsplit stop. */
internal fun directionWord(officialName: String): String? = ArahSuffix.find(officialName)?.groupValues?.get(1)

/** "Kali Grogol Arah Utara" -> "Arah Utara"; null for an unsplit stop. */
fun directionLabel(member: HubMember): String? = directionWord(member.officialName)?.let { "Arah $it" }

enum class Heading { UP, DOWN, LEFT, RIGHT }

/** Which way the side's arrow points: north up, east right, as on a map. */
fun headingOf(member: HubMember): Heading? = when (directionWord(member.officialName)?.lowercase()) {
    "utara" -> Heading.UP
    "selatan" -> Heading.DOWN
    "timur" -> Heading.RIGHT
    "barat" -> Heading.LEFT
    else -> null
}

/**
 * The sides of one operator, in the order their pills are drawn. A right-pointing arrow trails its
 * text, so that pill goes last, its arrow pointing off the end of the row; everything else keeps
 * API order.
 */
fun orderDirections(members: List<HubMember>): List<HubMember> =
    members.filter { headingOf(it) != null }.sortedBy { headingOf(it) == Heading.RIGHT }

/**
 * KCI's airport line is its own product to riders (ARL), not KRL. A KCI member counts only when
 * every line it serves is line A: Batu Ceper or Manggarai also carry commuter lines and stay KRL.
 */
fun isAirportRail(member: HubMember): Boolean =
    member.operator == "KCI" && member.lineKeys.isNotEmpty() && member.lineKeys.all { it == "KCI:A" }

private val ShortLabels = mapOf(
    "KCI" to "KRL",
    "MRTJ" to "MRT",
    "LRTJ" to "LRT",
    "LRTJBDB" to "LRT",
    "TJ" to "BRT",
    "APCGK" to "APM",
)

/** The tile's short label: there are no operator logos, so this carries the identity. */
fun tileLabel(member: HubMember): String =
    if (isAirportRail(member)) "ARL" else ShortLabels[member.operator] ?: member.operator

/**
 * The member a `?m=` value or a map tap names, falling back to the first. Null only for a hub with
 * no members.
 */
fun resolveMember(members: List<HubMember>, id: String?): HubMember? =
    members.firstOrNull { it.id == id } ?: members.firstOrNull()
