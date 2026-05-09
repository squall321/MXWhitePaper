/**
 * In-house fuzzy matcher for the Quick Switcher (Ctrl+P).
 *
 * Spec — keep simple, keep deterministic:
 *   - Lowercase both query and candidate.
 *   - Walk each query character; mark the first un-matched candidate index
 *     where it appears (in order). Tally `matched` and the longest streak of
 *     consecutive candidate-index hits.
 *   - score = matched / queryLength + (consecutiveMatches * 2)
 *
 * Empty query → score 0 (caller decides to fall back to "default" lists).
 */

/**
 * Returns the number of query chars that matched in order (the same walk used
 * for scoring). Useful for callers that want to filter "all-present" matches
 * before ranking by `fuzzyScore`.
 */
export function fuzzyMatchedCount(query: string, candidate: string): number {
  if (!query || !candidate) return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  let ci = 0
  let matched = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = -1
    for (let i = ci; i < c.length; i++) {
      if (c[i] === ch) {
        found = i
        break
      }
    }
    if (found < 0) continue
    matched++
    ci = found + 1
  }
  return matched
}

/** Per-spec score; 0 when query is empty so callers can short-circuit. */
export function fuzzyScore(query: string, candidate: string): number {
  if (!query) return 0
  if (!candidate) return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  let ci = 0
  let matched = 0
  let bestRun = 0
  let curRun = 0
  let lastCi = -2

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = -1
    for (let i = ci; i < c.length; i++) {
      if (c[i] === ch) {
        found = i
        break
      }
    }
    if (found < 0) {
      curRun = 0
      continue
    }
    matched++
    if (found === lastCi + 1) {
      curRun++
    } else {
      curRun = 1
    }
    if (curRun > bestRun) bestRun = curRun
    lastCi = found
    ci = found + 1
  }

  return matched / q.length + bestRun * 2
}

/**
 * Returns the candidate split into segments, each marked as `match: true` for
 * characters that contributed to an in-order fuzzy match (greedy left-to-right
 * — same walk as `fuzzyScore`). Consecutive match chars are coalesced into a
 * single `{match: true}` segment so the renderer can wrap a single `<mark>`.
 *
 * No allocation when `query` is empty — returns `[{ text: candidate, match: false }]`.
 */
export function highlightMatches(
  candidate: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  if (!candidate) return []
  if (!query) return [{ text: candidate, match: false }]

  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  // Mark which candidate indices participate in the fuzzy match.
  const hit: boolean[] = new Array(candidate.length).fill(false)
  let ci = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    for (let i = ci; i < c.length; i++) {
      if (c[i] === ch) {
        hit[i] = true
        ci = i + 1
        break
      }
    }
  }

  // Coalesce runs into segments preserving the original-case characters.
  const out: Array<{ text: string; match: boolean }> = []
  let i = 0
  while (i < candidate.length) {
    const isMatch = hit[i] === true
    let j = i + 1
    while (j < candidate.length && (hit[j] === true) === isMatch) j++
    out.push({ text: candidate.slice(i, j), match: isMatch })
    i = j
  }
  return out
}
