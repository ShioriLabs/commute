import { describe, expect, it } from 'vitest'
import { filterBestTier, keywordScore, popularityTerm, SCORE_THRESHOLD, substringEditDistance } from './fuzzy-match'

// Brute-force reference: minimum plain levenshtein between the needle and
// every substring of the haystack. The production Sellers DP must agree.
function naiveLevenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  )
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }
  return dp[a.length][b.length]
}

function naiveSubstringDistance(haystack: string, needle: string): number {
  let best = needle.length // empty-substring match
  for (let start = 0; start <= haystack.length; start++) {
    for (let end = start; end <= haystack.length; end++) {
      best = Math.min(best, naiveLevenshtein(haystack.slice(start, end), needle))
    }
  }
  return best
}

const HAYSTACKS = [
  'dukuh atas bni',
  'bundaran senayan',
  'karet kuningan',
  'karet',
  'jakarta kota',
  'blok m',
  'manggarai',
  'ac',
  ''
]

const NEEDLES = ['dukuj', 'dukuh ats', 'bundaran senayen', 'karrt', 'kart', 'ka', 'xx', 'manggarei', 'kota', '']

describe('substringEditDistance', () => {
  it('matches the brute-force reference within the bound', () => {
    for (const haystack of HAYSTACKS) {
      for (const needle of NEEDLES) {
        const exact = naiveSubstringDistance(haystack, needle)
        const label = `substringDist(${JSON.stringify(haystack)}, ${JSON.stringify(needle)})`
        expect(substringEditDistance(haystack, needle, 5), label).toBe(Math.min(exact, 5))
      }
    }
  })

  it('scores exact substrings as zero', () => {
    expect(substringEditDistance('jakarta kota', 'kota', 3)).toBe(0)
    expect(substringEditDistance('karet', 'karet', 3)).toBe(0)
  })

  it('finds typo windows across the keyword', () => {
    expect(substringEditDistance('dukuh atas bni', 'dukuj', 3)).toBe(1)
    expect(substringEditDistance('dukuh atas bni', 'dukuh ats', 3)).toBe(1)
    expect(substringEditDistance('bundaran senayan', 'bundaran senayen', 3)).toBe(1)
  })

  it('clamps to maxDistance', () => {
    expect(substringEditDistance('blok m', 'bundaran', 3)).toBe(3)
    expect(substringEditDistance('', 'dukuh', 3)).toBe(3)
  })
})

describe('keywordScore', () => {
  it('gives exact substrings a score of 0 regardless of length', () => {
    expect(keywordScore('jakarta kota', 'ka')).toBe(0)
    expect(keywordScore('karet', 'karet')).toBe(0)
  })

  it('keeps short queries substring-only (no fuzz budget under 4 chars)', () => {
    expect(keywordScore('karet', 'kst')).toBe(Infinity)
    expect(keywordScore('karet', 'xa')).toBe(Infinity)
  })

  it('allows 1 edit for 4-5 char queries', () => {
    expect(keywordScore('karet', 'kart')).toBe(1)
    expect(keywordScore('dukuh atas bni', 'dukuj')).toBe(1)
    // 2 edits is over budget at this length
    expect(keywordScore('karet', 'kaxx')).toBe(Infinity)
  })

  it('allows 2 edits for 6+ char queries', () => {
    expect(keywordScore('manggarai', 'manggarei')).toBe(1)
    expect(keywordScore('bundaran senayan', 'bundarxn senayen')).toBe(2)
    expect(keywordScore('bundaran senayan', 'bxndarxn senayen')).toBe(Infinity)
  })

  it('scores whole-word typos better than window-only matches', () => {
    // "karrt" is 1 edit from the word "karet" but also 1 edit from the
    // window "kart" inside "jakarta" — the whole-word typo must win so
    // popularity can't push Jakarta Kota above Karet.
    expect(keywordScore('karet', 'karrt')).toBe(1)
    expect(keywordScore('jakarta kota', 'karrt')).toBe(3)
    expect(keywordScore('jakarta kota', 'karrt') - keywordScore('karet', 'karrt'))
      .toBeGreaterThanOrEqual(2)
  })

  it('scores typos of word-boundary prefixes in the word tier', () => {
    // Sponsor-suffixed names: a typo'd multi-word query must rank the
    // sponsored sibling ("Lebak Bulus Bank Syariah Indonesia") in the same
    // tier as the short-named station, or the tier filter hides it.
    expect(keywordScore('lebak bulus bank syariah indonesia', 'lebak bulur')).toBe(1)
    // But a name that merely CONTAINS the phrase mid-string stays window tier.
    expect(keywordScore('underpass lebak bulus', 'lebak bulur')).toBe(3)
  })

  it('scores typo\'d prefixes of multi-word keywords in the word tier', () => {
    expect(keywordScore('dukuh atas bni', 'dukuh ats')).toBe(1)
  })

  it('scores window-only matches within budget as distance + 2', () => {
    // "atas bnj" starts mid-keyword: no word, prefix, or whole-keyword
    // candidate is within budget — only the window "atas bni" (1 edit).
    expect(keywordScore('dukuh atas bni', 'atas bnj')).toBe(3)
  })

  it('keeps every reachable tier under SCORE_THRESHOLD', () => {
    // Max window tier (2 edits -> 4) + max popularity term (1) must not
    // survive the filter; min window tier must.
    expect(SCORE_THRESHOLD).toBe(5)
    expect(keywordScore('dukuh atas bni', 'atas bnj')).toBeLessThan(SCORE_THRESHOLD)
  })

  it('bounds the popularity term to [0, 1]', () => {
    // The tier gap is only >= the popularity span while this holds, so an
    // out-of-range score from the index must not widen it.
    expect(popularityTerm(undefined)).toBe(0)
    expect(popularityTerm(0)).toBe(0)
    expect(popularityTerm(100)).toBe(1)
    expect(popularityTerm(1000)).toBe(1)
    expect(popularityTerm(-50)).toBe(0)
  })

  it('keeps 1-2 char keywords substring-only (line codes)', () => {
    expect(keywordScore('b', 'bundar')).toBe(Infinity)
    expect(keywordScore('ac', 'acol')).toBe(Infinity)
    expect(keywordScore('ac', 'ac')).toBe(0)
  })
})

describe('filterBestTier', () => {
  const scoreOf = (item: { matchScore: number }) => item.matchScore

  it('drops corrected results when exact matches exist', () => {
    // The "karet" case: 3 substring hits must hide the window matches
    // (Fatmawati Indomaret, Jakarta Kota, ...).
    const items = [{ matchScore: 0 }, { matchScore: 0 }, { matchScore: 3 }, { matchScore: 4 }]
    expect(filterBestTier(items, scoreOf)).toEqual([{ matchScore: 0 }, { matchScore: 0 }])
  })

  it('drops window matches when whole-word typo matches exist', () => {
    // The "karrt" case: Karet (word tier) must hide the "jakarta" windows.
    const items = [{ matchScore: 1 }, { matchScore: 2 }, { matchScore: 3 }]
    expect(filterBestTier(items, scoreOf)).toEqual([{ matchScore: 1 }, { matchScore: 2 }])
  })

  it('keeps window matches when they are all there is', () => {
    // The "dukuh ats" case: cross-word windows are the only results.
    const items = [{ matchScore: 3 }, { matchScore: 4 }]
    expect(filterBestTier(items, scoreOf)).toEqual(items)
  })

  it('handles an empty list', () => {
    expect(filterBestTier([], scoreOf)).toEqual([])
  })
})
