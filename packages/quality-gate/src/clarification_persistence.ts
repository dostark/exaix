/**
 * @module ClarificationPersistence
 * @path packages/quality-gate/src/clarification_persistence.ts
 * @description Persistence helpers for clarification sessions. Saves and loads
 * IClarificationSession as `<request-basename>_clarification.json` alongside
 * the request `.md` file, using atomic write (tmp + rename) for safety.
 * @architectural-layer Domain
 * @ungrounded
 * @related-files [packages/quality-gate/mod.ts, packages/quality-gate/src/clarification_engine.ts]
 */

import { basename, dirname, extname, join } from "@std/path";
import { ClarificationSessionSchema, type IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import { RequestStatus } from "@exaix/core/status";

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

/**
 * Derives the clarification JSON path from a request `.md` path.
 *
 * Example: `Workspace/Requests/my_request.md`
 *       →  `Workspace/Requests/my_request_clarification.json`
 */
function deriveClarificationPath(requestFilePath: string): string {
  const dir = dirname(requestFilePath);
  const ext = extname(requestFilePath);
  const base = basename(requestFilePath, ext);
  return join(dir, `${base}_clarification.json`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persists a clarification session as JSON, writing atomically via a `.tmp`
 * file that is renamed into place on success.
 */
export async function saveClarification(
  requestFilePath: string,
  session: IClarificationSession,
): Promise<void> {
  const jsonPath = deriveClarificationPath(requestFilePath);
  const tmpPath = `${jsonPath}.tmp`;
  const content = JSON.stringify(session, null, 2);

  await Deno.writeTextFile(tmpPath, content);
  await Deno.rename(tmpPath, jsonPath);
}

/**
 * Loads a previously saved clarification session. Returns `null` when the file
 * does not exist or cannot be parsed / validated against the schema.
 */
export async function loadClarification(
  requestFilePath: string,
): Promise<IClarificationSession | null> {
  const jsonPath = deriveClarificationPath(requestFilePath);

  let raw: string;
  try {
    raw = await Deno.readTextFile(jsonPath);
  } catch {
    return null;
  }

  try {
    const json = JSON.parse(raw) as unknown;
    return ClarificationSessionSchema.parse(json);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Re-entry helpers
// ---------------------------------------------------------------------------

/**
 * Finalizes a completed clarification session and writes `status: pending`
 * plus an `assessed_at` timestamp back to the request `.md` frontmatter
 * atomically (write `.tmp` → `Deno.rename`), triggering a FileWatcher re-entry
 * so the request re-enters the execution pipeline with the completed spec.
 *
 * @param requestFilePath - Absolute path to the request `.md` file.
 * @param session         - Completed `IClarificationSession` (any terminal status).
 * @param _spec           - `IRequestSpecification` compiled from the session
 *                          (injected into context on re-entry by the processor).
 */
export async function finalizeAndWritePending(
  requestFilePath: string,
  session: IClarificationSession,
  _spec: IRequestSpecification,
): Promise<void> {
  const original = await Deno.readTextFile(requestFilePath);
  const assessedAt = new Date().toISOString();

  // Replace status with pending
  let updated = original.replace(/^(status:\s*).+$/m, `$1${RequestStatus.PENDING}`);

  // Add or update assessed_at field after status line
  const assessedAtRegex = /^assessed_at:\s*.+$/m;
  if (assessedAtRegex.test(updated)) {
    updated = updated.replace(
      /^(assessed_at:\s*).+$/m,
      `$1"${assessedAt}"`,
    );
  } else {
    updated = updated.replace(
      /^(status:\s*.+)$/m,
      `$1\nassessed_at: "${assessedAt}"`,
    );
  }

  // Add or update clarification_session_path
  const clarPath = deriveClarificationPath(requestFilePath);
  const clarPathRegex = /^clarification_session_path:\s*.+$/m;
  if (clarPathRegex.test(updated)) {
    updated = updated.replace(
      /^(clarification_session_path:\s*).+$/m,
      `$1"${clarPath}"`,
    );
  } else {
    updated = updated.replace(
      /^(assessed_at:\s*.+)$/m,
      `$1\nclarification_session_path: "${clarPath}"`,
    );
  }

  // Reference session to suppress unused-variable warning
  void session;

  // Atomic write via tmp file
  const tmpPath = `${requestFilePath}.tmp`;
  await Deno.writeTextFile(tmpPath, updated);
  await Deno.rename(tmpPath, requestFilePath);
}

// ---------------------------------------------------------------------------
// Spec rendering
// ---------------------------------------------------------------------------

/**
 * Converts an `IRequestSpecification` into an agent-ready Markdown prompt.
 * Sections with empty arrays are omitted entirely; `summary` is always present.
 *
 * @param spec - The compiled specification from a clarification session.
 * @returns Structured Markdown string suitable for use as a `userPrompt`.
 */
export function renderSpecificationAsPrompt(spec: IRequestSpecification): string {
  const parts: string[] = [`## Summary\n${spec.summary}`];

  if (spec.goals.length > 0) {
    parts.push(`## Goals\n${spec.goals.map((g) => `- ${g}`).join("\n")}`);
  }

  if (spec.successCriteria.length > 0) {
    parts.push(
      `## Success Criteria\n${spec.successCriteria.map((c) => `- [ ] ${c}`).join("\n")}`,
    );
  }

  const hasScope = spec.scope.includes.length > 0 || spec.scope.excludes.length > 0;
  if (hasScope) {
    const scopeLines: string[] = [];
    if (spec.scope.includes.length > 0) {
      scopeLines.push(`**In scope:** ${spec.scope.includes.join(", ")}`);
    }
    if (spec.scope.excludes.length > 0) {
      scopeLines.push(`**Out of scope:** ${spec.scope.excludes.join(", ")}`);
    }
    parts.push(`## Scope\n${scopeLines.join("\n")}`);
  }

  if (spec.constraints.length > 0) {
    parts.push(`## Constraints\n${spec.constraints.map((c) => `- ${c}`).join("\n")}`);
  }

  if (spec.context.length > 0) {
    parts.push(`## Context\n${spec.context.map((c) => `- ${c}`).join("\n")}`);
  }

  return parts.join("\n\n");
}
