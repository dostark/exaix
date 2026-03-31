/**
 * @module SubjectGenerator
 * @path src/cli/helpers/subject_generator.ts
 * @description Utilities for generating and validating entity subjects (mnemonic names).
 * @architectural-layer CLI
 * * @related-files [tests/helpers/subject_generator_test.ts]
 */

/**
 * Extracts a fallback subject from a text description (e.g., first line).
 * Used when no explicit subject is provided and agent hasn't generated one yet.
 *
 * @param text The full request description or body
 * @param maxLength Maximum length of the fallback subject (default 60)
 * @returns A cleaned and truncated first line
 */
export function extractFallbackSubject(text: string, maxLength = 60): string {
  if (!text) return "";

  // Take first non-empty line
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";

  // Clean up: strip leading markdown prefixes (#, -, *, >, numbers.)
  const cleaned = firstLine.replace(/^[\s#\-*>\d.]+/, "").trim();

  if (cleaned.length <= maxLength) return cleaned;

  // Truncate at word boundary if possible
  const truncated = cleaned.substring(0, maxLength).replace(/\s+\S*$/, "");
  return truncated + "…";
}

/**
 * Validates a subject (e.g. from agent response).
 * Subject must be a non-empty single-line string within length limits.
 *
 * @param subject The subject to validate
 * @returns Cleaned subject string if valid, null otherwise
 */
export function validateSubject(subject: unknown): string | null {
  if (typeof subject !== "string") return null;

  const trimmed = subject.trim();
  if (trimmed.length === 0) return null;

  // Must be single line
  if (trimmed.includes("\n") || trimmed.includes("\r")) return null;

  // Length limit (Phase 42 spec: 80 chars)
  if (trimmed.length > 80) return null;

  // Reject generic filler or trace IDs
  const isGeneric = /^(request|req|plan|review|trace)[-.\s]*[a-f0-9-]*$/i.test(trimmed);
  if (isGeneric && trimmed.length > 20) return null; // UUIDs are long

  return trimmed;
}

/**
 * Resolves the final subject based on available inputs in order of priority.
 * 1. Explicit user-provided subject
 * 2. Validated agent-generated subject
 * 3. Text-extraction fallback from description
 *
 * @param options Resolution inputs
 * @returns The resolved subject string
 */
export function resolveSubject(options: {
  explicit?: string;
  agentSubject?: string;
  description: string;
}): string {
  // 1. Explicit takes precedence
  if (options.explicit?.trim()) {
    return options.explicit.trim();
  }

  // 2. Try agent-generated subject
  const validatedAgent = validateSubject(options.agentSubject);
  if (validatedAgent) {
    return validatedAgent;
  }

  // 3. Fallback to text extraction
  return extractFallbackSubject(options.description);
}
