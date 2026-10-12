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

import { SYMBOL_REFERENCE_EDGE_KIND } from "@exaix/core";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IPattern } from "@exaix/schemas";

import type { JSONValue } from "@exaix/core";

const MISSION_REPORTED_SENTINEL = "<!-- mission-reported -->";

const KNOWLEDGE_FILE = "knowledge.json";

/** Markdown updates are skipped when the mission-reported sentinel is present, so
 *  MissionReporter-authored content is never overwritten. */
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
 * Returns `null` when the file is missing or genuinely invalid.
 *
 * A snapshot written by a newer build may carry a relationship kind this build
 * does not know. Only that edge is dropped, and a warning names the count.
 * The tolerance covers `relationships[].kind` alone.
 * Any other invalid field still resolves to `null`.
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

  let parsed: JSONValue;
  try {
    parsed = JSON.parse(raw) as JSONValue;
  } catch {
    return null;
  }

  const strict = PortalKnowledgeSchema.safeParse(parsed);
  if (strict.success) return strict.data;

  const tolerated = tolerateUnknownRelationshipKinds(parsed);
  if (tolerated) {
    console.warn(
      `[knowledge_persistence] dropped an unrecognized relationship kind in ${knowledgePath}`,
    );
    return tolerated;
  }

  console.warn(`[knowledge_persistence] ${knowledgePath} is invalid and was ignored`);
  return null;
}

/** Every relationship kind this build can persist. */
const KNOWN_RELATIONSHIP_KINDS: readonly string[] = [
  "file_imports_file_internal",
  SYMBOL_REFERENCE_EDGE_KIND,
];

/**
 * Re-parses after replacing each relationship kind with a known one.
 *
 * That proves every other field is valid before any edge is dropped.
 * Only edges whose kind is unknown are removed.
 * Returns `undefined` when the snapshot is invalid for any other reason.
 */
function tolerateUnknownRelationshipKinds(parsed: JSONValue): IPortalKnowledge | undefined {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, JSONValue>;
  const relationships = record.relationships;
  if (!Array.isArray(relationships)) return undefined;
  if (!relationships.every((edge) => typeof edge === "object" && edge !== null && !Array.isArray(edge))) {
    return undefined;
  }

  const withPlaceholderKinds: JSONValue = {
    ...record,
    relationships: relationships.map((edge) => ({
      ...(edge as Record<string, JSONValue>),
      kind: KNOWN_RELATIONSHIP_KINDS[0],
    })),
  };
  const validated = PortalKnowledgeSchema.safeParse(withPlaceholderKinds);
  if (!validated.success) return undefined;

  const kept = relationships.filter((edge) =>
    KNOWN_RELATIONSHIP_KINDS.includes((edge as Record<string, JSONValue>).kind as string)
  ) as IPortalKnowledge["relationships"];

  return { ...validated.data, relationships: kept } as IPortalKnowledge;
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
