/**
 * @module SubjectGenerator
 * @path packages/cli/src/helpers/subject_generator.ts
 * @description Utilities for generating and validating entity subjects (mnemonic names).
 * @architectural-layer CLI
 */

import type { JSONValue } from "@exaix/core";

export function extractFallbackSubject(text: string, maxLength = 60): string {
  if (!text) return "";

  const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";

  const cleaned = firstLine.replace(/^[\s#\-*>\d.]+/, "").trim();

  if (cleaned.length <= maxLength) return cleaned;

  const truncated = cleaned.substring(0, maxLength).replace(/\s+\S*$/, "");
  return truncated + "…";
}

export function validateSubject(subject: JSONValue): string | null {
  if (typeof subject !== "string") return null;

  const trimmed = subject.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes("\n") || trimmed.includes("\r")) return null;

  if (trimmed.length > 80) return null;

  const isGeneric = /^(request|req|plan|review|trace)[-.\s]*[a-f0-9-]*$/i.test(trimmed);
  if (isGeneric && trimmed.length > 20) return null;

  return trimmed;
}

export function resolveSubject(options: {
  explicit?: string;
  agentSubject?: string;
  description: string;
}): string {
  if (options.explicit?.trim()) {
    return options.explicit.trim();
  }

  const validatedAgent = validateSubject(options.agentSubject);
  if (validatedAgent) {
    return validatedAgent;
  }

  return extractFallbackSubject(options.description);
}
