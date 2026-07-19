// Fuzzy keyword matching for the search surfaces (search sheet, fare picker).
//
// Approximate-substring matching (Sellers): the edit distance between the
// query and the BEST-MATCHING WINDOW anywhere inside the keyword, not the
// whole keyword. Plain levenshtein can never fuzzy-match a short query
// against a long station name (distance >= the length gap), so typos like
// "dukuj" would never find "dukuh atas bni"; here the window "dukuh" is 1
// edit away.

// Scores are tiered so match quality always outranks popularity (the ranking
// adds a popularity term in [0, 1] on top):
//   0     exact substring
//   1-2   typo in a whole word or the whole keyword ("karrt" -> "karet")
//   3-4   typo only matching a window inside the keyword ("karrt" -> the
//         "kart" in "jakarta") — real, but never above a whole-word typo
// The tier gap (2) >= the popularity span (1), so a popular station's window
// match can't overtake an unpopular station's word match. Surfaces filter at
// this threshold: max reachable score is 4 + popularity term < 5.
export const SCORE_THRESHOLD = 5

// Fuzz budget by query length: short queries are within 1-2 edits of nearly
// any window, so they stay exact-substring-only; longer queries carry enough
// signal to absorb typos.
function editBudget(queryLength: number): number {
  if (queryLength < 4) return 0
  if (queryLength < 6) return 1
  return 2
}

// Whole-string edit distance, clamped to maxDistance: rolling rows, length-gap
// early return, and a bail once no cell can come back under the bound.
function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) >= maxDistance) return maxDistance

  const width = b.length + 1
  let prev: number[] = new Array(width)
  let curr: number[] = new Array(width)
  for (let j = 0; j < width; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1]
        ? prev[j - 1] // match
        : 1 + Math.min(
          prev[j], // delete
          curr[j - 1], // insert
          prev[j - 1] // substitute
        )
      curr[j] = cost
      if (cost < rowMin) rowMin = cost
    }
    // Row minimums never decrease, so nothing downstream can beat the bound.
    if (rowMin >= maxDistance) return maxDistance
    const swap = prev
    prev = curr
    curr = swap
  }

  return Math.min(prev[b.length], maxDistance)
}

// Minimum edit distance between `needle` and any substring of `haystack`,
// clamped to `maxDistance`. Sellers DP: the first row is free (a match may
// start anywhere) and the answer is the minimum over the last row (it may
// end anywhere), computed column-by-column with two rolling arrays.
export function substringEditDistance(haystack: string, needle: string, maxDistance: number): number {
  // Needs at least needle.length - maxDistance chars to match: clamp early.
  if (needle.length - haystack.length >= maxDistance) return maxDistance

  const height = needle.length + 1
  let prev: number[] = new Array(height)
  let curr: number[] = new Array(height)
  // Empty haystack prefix: i deletions to match needle[0..i).
  for (let i = 0; i < height; i++) prev[i] = i
  let best = prev[needle.length]

  for (let j = 1; j <= haystack.length; j++) {
    curr[0] = 0 // free start: a window may begin at any haystack position
    for (let i = 1; i <= needle.length; i++) {
      const cost = needle[i - 1] === haystack[j - 1]
        ? prev[i - 1] // match
        : 1 + Math.min(
          prev[i - 1], // substitute
          prev[i], // skip haystack char inside the window
          curr[i - 1] // skip needle char
        )
      curr[i] = cost
    }
    if (curr[needle.length] < best) best = curr[needle.length]
    const swap = prev
    prev = curr
    curr = swap
  }

  return Math.min(best, maxDistance)
}

// Score a keyword against an (already lowercased) query per the tier table
// above; Infinity when nothing is within budget. Feeds the surfaces'
// finalScore = score + (1 - popularity) ranking as-is.
export function keywordScore(keyword: string, query: string): number {
  if (keyword.includes(query)) return 0
  // Short keywords (1-2 char line codes like "B", "M") match by substring
  // only — fuzzy would put them within budget of nearly any query.
  if (keyword.length < 3) return Infinity

  const budget = editBudget(query.length)
  if (budget === 0) return Infinity

  // Word tier: the query is a typo of the whole keyword, one of its words, or
  // a word-boundary prefix — users type names from the start, so "lebak bulur"
  // is as strong a signal for "lebak bulus bank syariah indonesia" (prefix
  // "lebak bulus") as for a station named just "lebak bulus". The length-gap
  // early-out keeps the extra candidates nearly free.
  let wordDistance = levenshteinDistance(keyword, query, budget + 1)
  if (wordDistance > budget && keyword.includes(' ')) {
    const words = keyword.split(' ')
    let prefixLength = 0
    for (let w = 0; w < words.length; w++) {
      const distance = levenshteinDistance(words[w], query, budget + 1)
      if (distance < wordDistance) wordDistance = distance
      prefixLength = w === 0 ? words[w].length : prefixLength + 1 + words[w].length
      if (w > 0 && prefixLength < keyword.length) {
        const prefixDistance = levenshteinDistance(keyword.slice(0, prefixLength), query, budget + 1)
        if (prefixDistance < wordDistance) wordDistance = prefixDistance
      }
      if (wordDistance === 1) break // can't do better: substring already missed
    }
  }
  if (wordDistance <= budget) return wordDistance

  // Window tier: the query matches somewhere inside the keyword.
  const windowDistance = substringEditDistance(keyword, query, budget + 1)
  return windowDistance <= budget ? windowDistance + 2 : Infinity
}

// Tier class of a keywordScore: 0 exact substring, 1 word typo, 2 window typo.
function matchTier(score: number): number {
  if (score === 0) return 0
  return score <= 2 ? 1 : 2
}

// Corrections are a fallback, not a supplement: when better-class matches
// exist, worse classes are noise (exact "karet" must not surface the "maret"
// in "fatmawati indomaret"; the word typo "karrt" -> Karet must not surface
// the "kart" window in "jakarta"). Keeps only the best tier class present.
export function filterBestTier<T>(items: T[], scoreOf: (item: T) => number): T[] {
  let best = Infinity
  for (const item of items) {
    const tier = matchTier(scoreOf(item))
    if (tier < best) best = tier
    if (best === 0) break
  }
  if (best === Infinity) return items
  return items.filter(item => matchTier(scoreOf(item)) === best)
}
