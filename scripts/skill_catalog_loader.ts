#!/usr/bin/env -S deno run -A
/**
 * @module SkillCatalogLoader
 * @path scripts/skill_catalog_loader.ts
 * @description Shared helper for repository gates that read authored skill folders. Builds the
 *   production SkillFolderLoader over one root with a no-op journal and a fixed operation context.
 * @architectural-layer Script
 * @dependencies [@exaix/core, @exaix/core/skills, @exaix/tool-runtime]
 * @related-files [scripts/check_skills.ts, scripts/check_skill_size.ts, scripts/check_skill_duplication.ts]
 *
 * Usage: imported by the skill gates and the scenario asset copier; not a standalone command.
 */

import { SkillRootKind } from "@exaix/core";
import { EventRegistry } from "@exaix/core/events";
import { createNoopEventLogger } from "@exaix/core/logger";
import { type ILoadedSkill, type ISkillOperationContext, SkillFolderLoader } from "@exaix/core/skills";
import { createPathSecurity } from "@exaix/tool-runtime";

const CATALOG_TRACE_ID = "00000000-0000-4000-8000-000000000206";

/** Fixed context for read-only gate scans. */
export const CATALOG_CONTEXT: ISkillOperationContext = {
  portal: null,
  traceId: CATALOG_TRACE_ID,
  requestId: null,
  flowId: null,
  flowStepId: null,
  agentRole: "catalog-gate",
  configGeneration: "gate",
};

/** A production loader over one read-only skill root. */
export function createCatalogLoader(
  path: string,
  kind: SkillRootKind = SkillRootKind.BLUEPRINT,
  project: string | null = null,
): SkillFolderLoader {
  const logger = createNoopEventLogger();
  return new SkillFolderLoader({
    roots: [{ path, kind, writable: false, project }],
    pathSecurity: createPathSecurity(),
    logger,
    eventRegistry: new EventRegistry(logger),
  });
}

/** Every valid skill folder under one root, whatever its lifecycle status. Missing root gives []. */
export async function loadCatalogRoot(
  path: string,
  kind: SkillRootKind = SkillRootKind.BLUEPRINT,
  project: string | null = null,
): Promise<ILoadedSkill[]> {
  return await createCatalogLoader(path, kind, project).listAll(CATALOG_CONTEXT);
}
