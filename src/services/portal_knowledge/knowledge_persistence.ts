/**
 * @module KnowledgePersistence
 * @path src/services/portal_knowledge/knowledge_persistence.ts
 * @description Persistence layer for IPortalKnowledge. Writes knowledge.json
 * atomically (write to .tmp then rename) under Memory/Projects/{portalAlias}/.
 * Conditionally updates overview.md and patterns.md via IMemoryBankService
 * when the <!-- mission-reported --> sentinel is absent. Never writes
 * references.md or decisions.md (ownership preserved for MissionReporter).
 * @architectural-layer Services
 * @related-files [src/services/portal_knowledge/portal_knowledge_service.ts, src/services/portal_knowledge/mod.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { type IPortalKnowledge, PortalKnowledgeSchema } from "@exaix/schemas/portal_knowledge.ts";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IPattern } from "@exaix/schemas/memory_bank.ts";
import type { JSONValue } from "@exaix/core";

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Sentinel string placed by MissionReporter — skip Markdown update when found. */
const MISSION_REPORTED_SENTINEL = "<!-- mission-reported -->";

/** Name of the atomic knowledge file. */
const KNOWLEDGE_FILE = "knowledge.json";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist an `IPortalKnowledge` snapshot for a portal.
 *
 * 1. Writes `knowledge.json` atomically under `{projectsDir}/{portalAlias}/`.
 * 2. Conditionally updates `overview.md` and `patterns.md` through
 *    `memoryBank` — skipped when the `<!-- mission-reported -->` sentinel is
 *    present, so MissionReporter-authored content is never overwritten.
 *    `references.md` and `decisions.md` are never touched.
 *
 * @param portalAlias - Portal alias (used as directory name).
 * @param knowledge   - The knowledge snapshot to persist.
 * @param memoryBank  - MemoryBankService for Markdown file updates.
 * @param projectsDir - Absolute path to `Memory/Projects/` directory.
 */
export async function saveKnowledge(
  portalAlias: string,
  knowledge: IPortalKnowledge,
  memoryBank: IMemoryBankService | null,
  projectsDir: string,
): Promise<void> {
  const portalDir = join(projectsDir, portalAlias);
  await ensureDir(portalDir);

  // 1. Atomic write of knowledge.json
  const knowledgePath = join(portalDir, KNOWLEDGE_FILE);
  const tmpPath = `${knowledgePath}.tmp`;
  await Deno.writeTextFile(tmpPath, JSON.stringify(knowledge, null, 2));
  await Deno.rename(tmpPath, knowledgePath);

  if (!memoryBank) return;

  // 2. Ensure project memory record exists (create if absent)
  const existing = await memoryBank.getProjectMemory(portalAlias);
  if (!existing) {
    await memoryBank.createProjectMemory({
      portal: portalAlias,
      overview: "",
      patterns: [],
      decisions: [],
      references: [],
    });
  }

  // 3. Conditionally update overview.md (skip if sentinel present)
  const shouldUpdateOverview = await _isSafeToWrite(
    join(portalDir, "overview.md"),
  );
  if (shouldUpdateOverview && knowledge.architectureOverview) {
    await memoryBank.updateProjectMemory(portalAlias, {
      overview: knowledge.architectureOverview,
    });
  }

  // 4. Conditionally update patterns.md (skip if sentinel present)
  const shouldUpdatePatterns = await _isSafeToWrite(
    join(portalDir, "patterns.md"),
  );
  if (shouldUpdatePatterns && knowledge.conventions.length > 0) {
    const patterns: IPattern[] = knowledge.conventions.map((c) => ({
      name: c.name,
      description: c.description,
      examples: c.examples,
      tags: [c.category],
    }));
    await memoryBank.updateProjectMemory(portalAlias, { patterns });
  }
}

/**
 * Load and validate a previously persisted `IPortalKnowledge` snapshot.
 *
 * @param portalAlias - Portal alias.
 * @param projectsDir - Absolute path to `Memory/Projects/` directory.
 * @returns The validated snapshot, or `null` if missing or invalid.
 */
export async function loadKnowledge(
  portalAlias: string,
  projectsDir: string,
): Promise<IPortalKnowledge | null> {
  const knowledgePath = join(projectsDir, portalAlias, KNOWLEDGE_FILE);
  let raw: string;
  try {
    raw = await Deno.readTextFile(knowledgePath);
  } catch {
    return null;
  }
  try {
    const parsed: JSONValue = JSON.parse(raw) as JSONValue;
    const result = PortalKnowledgeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the Markdown file at `filePath` does NOT contain the
 * mission-reported sentinel (or does not exist yet), indicating it is safe for
 * `PortalKnowledgeService` to write.
 */
async function _isSafeToWrite(filePath: string): Promise<boolean> {
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch {
    return true; // File absent → safe to write
  }
  return !content.includes(MISSION_REPORTED_SENTINEL);
}
