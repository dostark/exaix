/**
 * @module SkillContext
 * @path packages/core/src/skills/skill_context.ts
 * @description Builds the immutable operation context every skill read, match and revision
 *   snapshot carries. An invalid portal name is dropped so resolution falls back to global-only
 *   reads, and a missing trace is assigned once here so every later event shares it.
 * @architectural-layer Core
 * @dependencies [./skill_types.ts]
 * @related-files [packages/core/src/skills/skills.ts, packages/execution/src/agent_runner.ts]
 */

import type { ISkillOperationContext } from "./skill_types.ts";

/** Identity fields a caller knows about one operation. Everything but the role may be absent. */
export interface ISkillOperationInput {
  agentRole: string;
  portal?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  flowId?: string | null;
  flowStepId?: string | null;
  /** The service's current config generation. Absent means the static generation. */
  configGeneration?: string | null;
}

/** Config generation stamped on contexts until configured roots reload at runtime. */
export const SKILL_CONFIG_GENERATION_STATIC = "static";

const PORTAL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True for a plain portal name that is safe to use as a project skill root directory. */
export function isValidSkillPortalName(name: string): boolean {
  return PORTAL_NAME_PATTERN.test(name);
}

/** One immutable context for one operation. */
export function createSkillOperationContext(input: ISkillOperationInput): ISkillOperationContext {
  const portal = input.portal && isValidSkillPortalName(input.portal) ? input.portal : null;
  return {
    portal,
    traceId: input.traceId || crypto.randomUUID(),
    requestId: input.requestId ?? null,
    flowId: input.flowId ?? null,
    flowStepId: input.flowStepId ?? null,
    agentRole: input.agentRole,
    configGeneration: input.configGeneration ?? SKILL_CONFIG_GENERATION_STATIC,
  };
}
