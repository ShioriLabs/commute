package id.shiorilabs.commute.feature.hub.domain

/** A hub: stations that count as one place to a rider, in the order its page lists them. */
data class Hub(
    /** The URL key, e.g. `dukuh-atas`. */
    val slug: String,
    val name: String,
    val kind: HubKind,
    val members: List<HubMember>,
)

/**
 * What kind of place a hub is, which its page names under the title. The API may add kinds; an
 * unknown one reads as [INTEGRATED], as on the web.
 */
enum class HubKind {
    /** Differently named stations in one complex ("Pumpunan Moda"). */
    HUB,

    /** One place to a rider, split only in the operators' data ("Stasiun Terintegrasi"). */
    INTEGRATED,
}

/** A station in a hub. */
data class HubMember(
    /** `OPERATOR-CODE`, e.g. `KCI-SUD`. */
    val id: String,
    val name: String,
    val operator: String,
    /** `OPERATOR:CODE`, resolved through the line dictionary by whoever draws them. */
    val lineKeys: List<String>,
)
