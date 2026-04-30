/**
 * @module TextUtils
 * @path src/helpers/text.ts
 * @description Text processing utilities including keyword extraction and stop-word filtering.
 * @architectural-layer Helpers
 * @related-files ["src/services/memory/memory_bank.ts"]
 */
export const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "our",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "not",
  "only",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "here",
  "there",
  "if",
  "then",
  "else",
  "as",
  "please",
  "help",
  "want",
  "like",
  "make",
  "get",
]);

/**
 * Extract keywords from text for indexing or skill matching
 * @param text - Text to extract keywords from
 * @param minLength - Minimum word length to include (default: 3)
 * @returns Array of unique keywords
 */
export function extractKeywords(text: string, minLength = 3): string[] {
  if (!text) return [];

  // Split by non-word characters and convert to lowercase
  const words = text.toLowerCase().split(/[^a-z0-9]+/);

  return [
    ...new Set(
      words.filter((w) => w.length >= minLength && !STOP_WORDS.has(w)),
    ),
  ];
}
