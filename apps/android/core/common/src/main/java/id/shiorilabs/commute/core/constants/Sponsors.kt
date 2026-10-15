package id.shiorilabs.commute.core.constants

/**
 * Naming-rights sponsors that show up as the tail of a station name ("Blok M BCA", "Lebak Bulus Bank
 * Syariah Indonesia"), keyed by the sponsor's full name as the operator prints it.
 *
 * Taken from the production `stations` table (`name` for TransJakarta, `formattedName` for MRT, LRT
 * and KRL), 2026-10-15. The values are aliases the same sponsor has appeared under in data or by
 * rebrand (Bank DKI became Bank Jakarta). They are for matching only: never show an alias in place
 * of the full name, the operators keep the sponsor whole and cut the place name instead.
 *
 * Hand-maintained and not exhaustive: sponsorships change without notice, so a lookup can miss. The
 * tail alone cannot tell a sponsor from a building ("Menara Astra", "Wisma Mandiri" are places), so
 * treat [sponsorOf] as a hint on names already known to be station branding.
 */
val SPONSOR_NAMES: Map<String, List<String>> = mapOf(
    // Banks and payments
    "Bank Syariah Indonesia" to listOf("BSI"),
    "Bank Jakarta" to listOf("Bank DKI"),
    "BNI" to listOf("Bank BNI", "Bank Negara Indonesia"),
    "BNI City" to emptyList(),
    "BCA" to listOf("Bank BCA", "Bank Central Asia"),
    "Mandiri" to listOf("Bank Mandiri"),
    "Mastercard" to emptyList(),
    "Visa" to emptyList(),
    // Automotive and conglomerates
    "Astra" to listOf("Astra International"),
    "TOYOTA Rangga" to listOf("Toyota Rangga"),
    // Retail, consumer, telco and property
    "Indomaret" to emptyList(),
    "TUKU" to emptyList(),
    "Telkomsel" to emptyList(),
    "ParagonCorp" to listOf("Paragon Corp", "Paragon"),
    "Summarecon Mall" to listOf("Summarecon"),
    // Not a company, but a naming-rights buyer all the same (Halte Petukangan, Koridor 13)
    "D'MASIV" to emptyList(),
)

/**
 * The sponsor a station name ends with, as its full name from [SPONSOR_NAMES], or null when the
 * name carries none. Longest match wins so "Bank Syariah Indonesia" is not mistaken for a shorter
 * tail, and the place must precede it: a name that is only a sponsor has no sponsor part.
 */
fun sponsorOf(stationName: String): String? {
    val name = stationName.trim()
    return SPONSOR_NAMES
        .flatMap { (full, aliases) -> (aliases + full).map { it to full } }
        .sortedByDescending { (variant, _) -> variant.length }
        .firstOrNull { (variant, _) -> name.endsWith(" $variant", ignoreCase = true) }
        ?.second
}
