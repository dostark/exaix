/**
 * @module KnowledgePersistence
 * @path packages/portal/knowledge/knowledge_persistence.ts
 * @description Persistence layer for IPortalKnowledge. Writes knowledge.json
 * atomically (write to .tmp then rename) under Memory/Projects/{portalAlias}/.
 * Conditionally updates overview.md and patterns.md via IMemoryBankService
 * when the <!-- mission-reported --> sentinel is absent. Never writes
 * references.md or decisions.md (ownership preserved for MissionReporter).
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { type IPortalKnowledge, PortalKnowledgeSchema } from "@exaix/schemas";

import type { IMemoryBankService } from "@exaix/core/types";
import type { IPattern } from "@exaix/schemas";

import type { JSONValue } from "@exaix/core";

const MISSION_REPORTED_SENTINEL = "<!-- mission-reported -->";

const KNOWLEDGE_FILE = "knowledge.json";

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

  const knowledgePath = join(portalDir, KNOWLEDGE_FILE);
  const tmpPath = `${knowledgePath}.tmp`;
  await Deno.writeTextFile(tmpPath, JSON.stringify(knowledge, null, 2));
  await Deno.rename(tmpPath, knowledgePath);

  if (!memoryBank) return;

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

  const shouldUpdateOverview = await _isSafeToWrite(
    join(portalDir, "overview.md"),
  );
  if (shouldUpdateOverview && knowledge.architectureOverview) {
    await memoryBank.updateProjectMemory(portalAlias, {
      overview: knowledge.architectureOverview,
    });
  }

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

async function _isSafeToWrite(filePath: string): Promise<boolean> {
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch {
    return true;
  }
  return !content.includes(MISSION_REPORTED_SENTINEL);
}
