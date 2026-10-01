package id.shiorilabs.commute.feature.search.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.min

/** Ported from the web's `utils/fuzzy-match.test.ts`, so both clients are held to the same cases. */
class FuzzyMatchTest {

    // Brute-force reference: minimum plain levenshtein between the needle and every substring of
    // the haystack. The production Sellers DP must agree.
    private fun naiveLevenshtein(a: String, b: String): Int {
        val dp = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in 0..a.length) dp[i][0] = i
        for (j in 0..b.length) dp[0][j] = j
        for (i in 1..a.length) {
            for (j in 1..b.length) {
                dp[i][j] = if (a[i - 1] == b[j - 1]) {
                    dp[i - 1][j - 1]
                } else {
                    1 + minOf(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
                }
            }
        }
        return dp[a.length][b.length]
    }

    private fun naiveSubstringDistance(haystack: String, needle: String): Int {
        var best = needle.length // empty-substring match
        for (start in 0..haystack.length) {
            for (end in start..haystack.length) {
                best = min(best, naiveLevenshtein(haystack.substring(start, end), needle))
            }
        }
        return best
    }

    private val haystacks = listOf(
        "dukuh atas bni", "bundaran senayan", "karet kuningan", "karet", "jakarta kota", "blok m",
        "manggarai", "ac", "",
    )

    private val needles = listOf(
        "dukuj", "dukuh ats", "bundaran senayen", "karrt", "kart", "ka", "xx", "manggarei", "kota", "",
    )

    @Test
    fun `substringEditDistance matches the brute-force reference within the bound`() {
        for (haystack in haystacks) {
            for (needle in needles) {
                assertEquals(
                    "substringDist(\"$haystack\", \"$needle\")",
                    min(naiveSubstringDistance(haystack, needle), 5),
                    substringEditDistance(haystack, needle, 5),
                )
            }
        }
    }

    @Test
    fun `substringEditDistance scores exact substrings as zero`() {
        assertEquals(0, substringEditDistance("jakarta kota", "kota", 3))
        assertEquals(0, substringEditDistance("karet", "karet", 3))
    }

    @Test
    fun `substringEditDistance finds typo windows across the keyword`() {
        assertEquals(1, substringEditDistance("dukuh atas bni", "dukuj", 3))
        assertEquals(1, substringEditDistance("dukuh atas bni", "dukuh ats", 3))
        assertEquals(1, substringEditDistance("bundaran senayan", "bundaran senayen", 3))
    }

    @Test
    fun `substringEditDistance clamps to maxDistance`() {
        assertEquals(3, substringEditDistance("blok m", "bundaran", 3))
        assertEquals(3, substringEditDistance("", "dukuh", 3))
    }

    @Test
    fun `exact substrings score 0 regardless of length`() {
        assertEquals(0.0, keywordScore("jakarta kota", "ka"), 0.0)
        assertEquals(0.0, keywordScore("karet", "karet"), 0.0)
    }

    @Test
    fun `short queries stay substring-only`() {
        assertEquals(NO_MATCH, keywordScore("karet", "kst"), 0.0)
        assertEquals(NO_MATCH, keywordScore("karet", "xa"), 0.0)
    }

    @Test
    fun `4-5 char queries allow 1 edit`() {
        assertEquals(1.0, keywordScore("karet", "kart"), 0.0)
        assertEquals(1.0, keywordScore("dukuh atas bni", "dukuj"), 0.0)
        // 2 edits is over budget at this length
        assertEquals(NO_MATCH, keywordScore("karet", "kaxx"), 0.0)
    }

    @Test
    fun `6+ char queries allow 2 edits`() {
        assertEquals(1.0, keywordScore("manggarai", "manggarei"), 0.0)
        assertEquals(2.0, keywordScore("bundaran senayan", "bundarxn senayen"), 0.0)
        assertEquals(NO_MATCH, keywordScore("bundaran senayan", "bxndarxn senayen"), 0.0)
    }

    @Test
    fun `whole-word typos score better than window-only matches`() {
        // "karrt" is 1 edit from the word "karet" but also 1 edit from the window "kart" inside
        // "jakarta" — the whole-word typo must win so popularity can't push Jakarta Kota above Karet.
        assertEquals(1.0, keywordScore("karet", "karrt"), 0.0)
        assertEquals(3.0, keywordScore("jakarta kota", "karrt"), 0.0)
        assertTrue(keywordScore("jakarta kota", "karrt") - keywordScore("karet", "karrt") >= 2)
    }

    @Test
    fun `typos of word-boundary prefixes score in the word tier`() {
        assertEquals(1.0, keywordScore("lebak bulus bank syariah indonesia", "lebak bulur"), 0.0)
        // But a name that merely CONTAINS the phrase mid-string stays window tier.
        assertEquals(3.0, keywordScore("underpass lebak bulus", "lebak bulur"), 0.0)
        assertEquals(1.0, keywordScore("dukuh atas bni", "dukuh ats"), 0.0)
    }

    @Test
    fun `window-only matches within budget score distance + 2`() {
        assertEquals(3.0, keywordScore("dukuh atas bni", "atas bnj"), 0.0)
        assertTrue(keywordScore("dukuh atas bni", "atas bnj") < SCORE_THRESHOLD)
    }

    @Test
    fun `the popularity term is bounded to 0 to 1`() {
        assertEquals(0.0, popularityTerm(null), 0.0)
        assertEquals(0.0, popularityTerm(0.0), 0.0)
        assertEquals(1.0, popularityTerm(100.0), 0.0)
        assertEquals(1.0, popularityTerm(1000.0), 0.0)
        assertEquals(0.0, popularityTerm(-50.0), 0.0)
    }

    @Test
    fun `1-2 char keywords stay substring-only`() {
        assertEquals(NO_MATCH, keywordScore("b", "bundar"), 0.0)
        assertEquals(NO_MATCH, keywordScore("ac", "acol"), 0.0)
        assertEquals(0.0, keywordScore("ac", "ac"), 0.0)
    }

    @Test
    fun `filterBestTier drops corrected results when exact matches exist`() {
        assertEquals(listOf(0.0, 0.0), filterBestTier(listOf(0.0, 0.0, 3.0, 4.0)) { it })
    }

    @Test
    fun `filterBestTier drops window matches when whole-word typo matches exist`() {
        assertEquals(listOf(1.0, 2.0), filterBestTier(listOf(1.0, 2.0, 3.0)) { it })
    }

    @Test
    fun `filterBestTier keeps window matches when they are all there is`() {
        assertEquals(listOf(3.0, 4.0), filterBestTier(listOf(3.0, 4.0)) { it })
    }

    @Test
    fun `filterBestTier handles an empty list`() {
        assertEquals(emptyList<Double>(), filterBestTier(emptyList<Double>()) { it })
    }
}
