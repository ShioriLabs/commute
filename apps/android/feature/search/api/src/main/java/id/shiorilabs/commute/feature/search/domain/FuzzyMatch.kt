package id.shiorilabs.commute.feature.search.domain

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/*
 * Fuzzy keyword matching for search. A line-for-line port of the web's `utils/fuzzy-match.ts`, so
 * both clients rank the same query the same way; keep the two in step.
 *
 * Approximate-substring matching (Sellers): the edit distance between the query and the
 * BEST-MATCHING WINDOW anywhere inside the keyword, not the whole keyword. Plain levenshtein can
 * never fuzzy-match a short query against a long station name (distance >= the length gap), so
 * typos like "dukuj" would never find "dukuh atas bni"; here the window "dukuh" is 1 edit away.
 *
 * Scores are tiered so match quality always outranks popularity (the ranking adds a popularity term
 * in [0, 1] on top):
 *   0     exact substring
 *   1-2   typo in a whole word or the whole keyword ("karrt" -> "karet")
 *   3-4   typo only matching a window inside the keyword ("karrt" -> the "kart" in "jakarta") —
 *         real, but never above a whole-word typo
 * The tier gap (2) >= the popularity span (1), so a popular station's window match can't overtake
 * an unpopular station's word match. Results are filtered at this threshold: max reachable score is
 * 4 + popularity term < 5.
 */
const val SCORE_THRESHOLD = 5.0

/** `STATION_SCORE_MAX` in `@commute/constants`: the top of the index's popularity scale. */
private const val STATION_SCORE_MAX = 100.0

/** No match within budget. */
const val NO_MATCH = Double.POSITIVE_INFINITY

/**
 * A station's popularity as a term in [0, 1], for the ranking above.
 *
 * Clamped, not just divided: the tier gap only holds while this stays bounded, so a score that
 * arrives out of range from the index must not be able to reorder match tiers.
 */
fun popularityTerm(score: Double?): Double = min(1.0, max(0.0, (score ?: 0.0) / STATION_SCORE_MAX))

/**
 * Fuzz budget by query length: short queries are within 1-2 edits of nearly any window, so they stay
 * exact-substring-only; longer queries carry enough signal to absorb typos.
 */
private fun editBudget(queryLength: Int): Int = when {
    queryLength < 4 -> 0
    queryLength < 6 -> 1
    else -> 2
}

/**
 * Whole-string edit distance, clamped to [maxDistance]: rolling rows, length-gap early return, and a
 * bail once no cell can come back under the bound.
 */
private fun levenshteinDistance(a: String, b: String, maxDistance: Int): Int {
    if (a == b) {
        return 0
    }
    if (abs(a.length - b.length) >= maxDistance) {
        return maxDistance
    }

    val width = b.length + 1
    var prev = IntArray(width) { it }
    var curr = IntArray(width)

    for (i in 1..a.length) {
        curr[0] = i
        var rowMin = i
        for (j in 1..b.length) {
            val cost = if (a[i - 1] == b[j - 1]) {
                prev[j - 1] // match
            } else {
                1 + minOf(
                    prev[j], // delete
                    curr[j - 1], // insert
                    prev[j - 1], // substitute
                )
            }
            curr[j] = cost
            if (cost < rowMin) {
                rowMin = cost
            }
        }
        // Row minimums never decrease, so nothing downstream can beat the bound.
        if (rowMin >= maxDistance) {
            return maxDistance
        }
        val swap = prev
        prev = curr
        curr = swap
    }

    return min(prev[b.length], maxDistance)
}

/**
 * Minimum edit distance between [needle] and any substring of [haystack], clamped to [maxDistance].
 * Sellers DP: the first row is free (a match may start anywhere) and the answer is the minimum over
 * the last row (it may end anywhere), computed column-by-column with two rolling arrays.
 */
fun substringEditDistance(haystack: String, needle: String, maxDistance: Int): Int {
    // Needs at least needle.length - maxDistance chars to match: clamp early.
    if (needle.length - haystack.length >= maxDistance) {
        return maxDistance
    }

    val height = needle.length + 1
    // Empty haystack prefix: i deletions to match needle[0..i).
    var prev = IntArray(height) { it }
    var curr = IntArray(height)
    var best = prev[needle.length]

    for (j in 1..haystack.length) {
        curr[0] = 0 // free start: a window may begin at any haystack position
        for (i in 1..needle.length) {
            curr[i] = if (needle[i - 1] == haystack[j - 1]) {
                prev[i - 1] // match
            } else {
                1 + minOf(
                    prev[i - 1], // substitute
                    prev[i], // skip haystack char inside the window
                    curr[i - 1], // skip needle char
                )
            }
        }
        if (curr[needle.length] < best) {
            best = curr[needle.length]
        }
        val swap = prev
        prev = curr
        curr = swap
    }

    return min(best, maxDistance)
}

/**
 * Score a keyword against an (already lowercased) query per the tier table above; [NO_MATCH] when
 * nothing is within budget.
 */
fun keywordScore(keyword: String, query: String): Double {
    if (keyword.contains(query)) {
        return 0.0
    }
    // Short keywords (1-2 char line codes like "B", "M") match by substring only — fuzzy would put
    // them within budget of nearly any query.
    if (keyword.length < 3) {
        return NO_MATCH
    }

    val budget = editBudget(query.length)
    if (budget == 0) {
        return NO_MATCH
    }

    // Word tier: the query is a typo of the whole keyword, one of its words, or a word-boundary
    // prefix — riders type names from the start, so "lebak bulur" is as strong a signal for "lebak
    // bulus bank syariah indonesia" (prefix "lebak bulus") as for a station named just "lebak
    // bulus". The length-gap early-out keeps the extra candidates nearly free.
    var wordDistance = levenshteinDistance(keyword, query, budget + 1)
    if (wordDistance > budget && keyword.contains(' ')) {
        val words = keyword.split(' ')
        var prefixLength = 0
        for (w in words.indices) {
            val distance = levenshteinDistance(words[w], query, budget + 1)
            if (distance < wordDistance) {
                wordDistance = distance
            }
            prefixLength = if (w == 0) words[w].length else prefixLength + 1 + words[w].length
            if (w > 0 && prefixLength < keyword.length) {
                val prefixDistance = levenshteinDistance(keyword.substring(0, prefixLength), query, budget + 1)
                if (prefixDistance < wordDistance) {
                    wordDistance = prefixDistance
                }
            }
            if (wordDistance == 1) {
                break // can't do better: substring already missed
            }
        }
    }
    if (wordDistance <= budget) {
        return wordDistance.toDouble()
    }

    // Window tier: the query matches somewhere inside the keyword.
    val windowDistance = substringEditDistance(keyword, query, budget + 1)
    return if (windowDistance <= budget) windowDistance + 2.0 else NO_MATCH
}

/** Tier class of a [keywordScore]: 0 exact substring, 1 word typo, 2 window typo. */
private fun matchTier(score: Double): Int = when {
    score == 0.0 -> 0
    score <= 2 -> 1
    else -> 2
}

/**
 * Corrections are a fallback, not a supplement: when better-class matches exist, worse classes are
 * noise (exact "karet" must not surface the "maret" in "fatmawati indomaret"; the word typo "karrt"
 * -> Karet must not surface the "kart" window in "jakarta"). Keeps only the best tier class present.
 */
fun <T> filterBestTier(items: List<T>, scoreOf: (T) -> Double): List<T> {
    var best = Int.MAX_VALUE
    for (item in items) {
        val tier = matchTier(scoreOf(item))
        if (tier < best) {
            best = tier
        }
        if (best == 0) {
            break
        }
    }
    if (best == Int.MAX_VALUE) {
        return items
    }
    return items.filter { matchTier(scoreOf(it)) == best }
}
