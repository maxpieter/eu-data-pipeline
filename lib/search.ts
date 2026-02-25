/**
 * Fuzzy search matching utilities.
 *
 * Two scoring conventions are provided so that every existing call-site keeps
 * working without changes to the surrounding logic.
 */

/**
 * Fuzzy match with a "lower is better" score.
 *
 * - Exact substring match returns the index where the pattern starts (>= 0).
 * - Fuzzy match (all characters appear in order) returns score + 100.
 * - No match returns -1.
 *
 * Used by rebel-score pages where results are sorted ascending by score.
 */
export function fuzzyMatch(pattern: string, str: string): number {
  pattern = pattern.toLowerCase()
  str = str.toLowerCase()

  // Exact substring match gets best score
  if (str.includes(pattern)) {
    return str.indexOf(pattern)
  }

  // Fuzzy match - all characters must appear in order
  let patternIdx = 0
  let score = 0
  let lastMatchIdx = -1

  for (let i = 0; i < str.length && patternIdx < pattern.length; i++) {
    if (str[i] === pattern[patternIdx]) {
      if (lastMatchIdx !== -1) {
        score += (i - lastMatchIdx - 1) * 10
      }
      lastMatchIdx = i
      patternIdx++
    }
  }

  if (patternIdx === pattern.length) {
    return score + 100
  }

  return -1
}

/**
 * Fuzzy match with a "higher is better" score.
 *
 * - Exact match: 100
 * - Starts-with: 90
 * - Contains: 70
 * - Fuzzy (all characters in order): up to 60
 * - No match: 0
 *
 * Used by MEP meetings graph where results are sorted descending by score.
 */
export function fuzzyMatchScore(text: string, query: string): number {
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  if (textLower === queryLower) return 100
  if (textLower.startsWith(queryLower)) return 90
  if (textLower.includes(queryLower)) return 70

  let score = 0
  let queryIndex = 0
  let consecutive = 0

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      score += 10 + consecutive * 5
      consecutive++
      queryIndex++
    } else {
      consecutive = 0
    }
  }

  return queryIndex === queryLower.length ? Math.min(60, score) : 0
}
