/**
 * @module FuzzyStringMatch
 * @path tests/helpers/fuzzy_string_match.ts
 * @description Paraphrase-tolerant substring similarity for asserting that a real LLM
 *   response contains (an approximation of) an expected fact, without requiring an exact
 *   quote. Useful for live-provider tests where the model may reasonably reword content
 *   it was asked to report verbatim. Built on @std/text's Levenshtein distance.
 */

import { levenshteinDistance } from "@std/text/levenshtein-distance";

/**
 * Best-effort normalized similarity (0..1, higher = closer) between `needle` and the
 * best-matching substring of `haystack`, tolerant of paraphrase-driven length changes.
 * `needle` is expected to appear embedded in a longer response (e.g. after a preamble)
 * and possibly reworded, so both a fixed comparison window (dominated by length mismatch)
 * and a whole-string distance (dominated by unrelated preamble/prefix text) would misjudge
 * it — this slides windows across a 0.6x-1.4x length range of `needle` across `haystack`
 * and keeps the best-scoring one.
 */
export function bestSubstringSimilarity(haystack: string, needle: string): number {
  const normalizedNeedle = needle.toLowerCase();
  const normalizedHaystack = haystack.toLowerCase();
  const minWindowLen = Math.max(1, Math.floor(normalizedNeedle.length * 0.6));
  const maxWindowLen = Math.min(normalizedHaystack.length, Math.ceil(normalizedNeedle.length * 1.4));
  const windowStep = Math.max(1, Math.floor(normalizedNeedle.length * 0.1));

  if (normalizedHaystack.length <= minWindowLen) {
    const distance = levenshteinDistance(normalizedHaystack, normalizedNeedle);
    return 1 - distance / Math.max(normalizedNeedle.length, normalizedHaystack.length, 1);
  }

  let best = 0;
  for (let windowLen = minWindowLen; windowLen <= maxWindowLen; windowLen += windowStep) {
    for (let i = 0; i <= normalizedHaystack.length - windowLen; i++) {
      const window = normalizedHaystack.slice(i, i + windowLen);
      const distance = levenshteinDistance(window, normalizedNeedle);
      const similarity = 1 - distance / Math.max(normalizedNeedle.length, windowLen);
      if (similarity > best) best = similarity;
    }
  }
  return best;
}
