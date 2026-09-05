/**
 * Fuzzy id matching used to recover from a model retyping a UUID from
 * memory across tool calls instead of reusing it verbatim -- a single
 * mistyped/transposed character or an outright fabricated id otherwise
 * just gets rejected by Homebox with no hint of what the correct id was,
 * so the model retries blindly (sometimes for many turns) instead of
 * self-correcting on the next call.
 */

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let diagonal = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(diagonal, dp[j], dp[j - 1]);
      diagonal = temp;
    }
  }
  return dp[n];
}

export interface IdCandidate {
  id: string;
  name?: string;
}

// An LLM mangling a UUID it's retyping from memory can garble more than a
// single character (observed in practice: dropping one char and swapping a
// few more nearby, several edits total) -- but two genuinely different,
// independently-random UUIDs almost never land this close (36 mostly-random
// characters apart, chance collisions on more than a handful of positions
// are vanishingly unlikely). 8 comfortably covers realistic typos while
// staying far below that noise floor.
const MAX_SUGGESTION_DISTANCE = 8;

/**
 * Find the real id closest to a possibly-mistyped one. Returns undefined
 * when nothing is close enough to be a confident correction rather than an
 * unrelated id.
 */
export function findClosestId(badId: string, candidates: IdCandidate[]): IdCandidate | undefined {
  let best: IdCandidate | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    if (candidate.id === badId) continue; // an exact match wouldn't be erroring
    const distance = levenshtein(badId, candidate.id);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= MAX_SUGGESTION_DISTANCE ? best : undefined;
}
