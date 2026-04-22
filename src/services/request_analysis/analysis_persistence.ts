/**
 * @module AnalysisPersistence
 * @path src/services/request_analysis/analysis_persistence.ts
 * @description Atomic file-system persistence helpers for `IRequestAnalysis`.
 * Derives a `_analysis.json` sibling path from the request `.md` file path and
 * uses the write-to-temp-then-rename pattern to ensure crash-safe writes.
 * Validates loaded JSON against `RequestAnalysisSchema` before returning.
 * @architectural-layer Services
 * * @related-files [src/services/request_analysis/request_analyzer.ts, src/services/request_analysis/mod.ts]
 */

import { type IRequestAnalysis, RequestAnalysisSchema } from "@exaix/schemas/request_analysis.ts";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Derive the `_analysis.json` path from the request `.md` path.
 *
 * Example:
 *   `Workspace/Requests/my-request.md` → `Workspace/Requests/my-request_analysis.json`
 */
export function deriveAnalysisPath(requestFilePath: string): string {
  // Strip any extension and append `_analysis.json`
  const dotIdx = requestFilePath.lastIndexOf(".");
  const base = dotIdx > 0 ? requestFilePath.slice(0, dotIdx) : requestFilePath;
  return `${base}_analysis.json`;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist `analysis` alongside `requestFilePath` as `<stem>_analysis.json`.
 * Writes atomically: first to `<path>.tmp`, then renames to the final path.
 */
export async function saveAnalysis(
  requestFilePath: string,
  analysis: IRequestAnalysis,
): Promise<void> {
  const finalPath = deriveAnalysisPath(requestFilePath);
  const tmpPath = `${finalPath}.tmp`;
  const json = JSON.stringify(analysis, null, 2);
  await Deno.writeTextFile(tmpPath, json);
  await Deno.rename(tmpPath, finalPath);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load and validate the `_analysis.json` sibling of `requestFilePath`.
 * Returns `null` if the file does not exist, cannot be parsed, or fails schema
 * validation — callers must handle the absent case gracefully.
 */
export async function loadAnalysis(requestFilePath: string): Promise<IRequestAnalysis | null> {
  const jsonPath = deriveAnalysisPath(requestFilePath);
  let raw: string;
  try {
    raw = await Deno.readTextFile(jsonPath);
  } catch {
    return null; // file not found or unreadable
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // malformed JSON
  }

  const result = RequestAnalysisSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}
