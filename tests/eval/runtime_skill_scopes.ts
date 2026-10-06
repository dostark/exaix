/**
 * @module RuntimeSkillScopes
 * @path tests/eval/runtime_skill_scopes.ts
 * @architectural-layer Test
 * @description The repository's authored skill catalog as the runtime sees it, declared once.
 *   Any check that asks "does this skill exist at runtime?" loads the skill folders through
 *   the production loader (`Blueprints/Skills` plus the `Exaix` project root), so there is one
 *   answer and no compiled copy to drift from.
 * @dependencies [@exaix/testing]
 * @related-files [tests/eval/agent_role_default_skills_test.ts, tests/eval/skill_catalog_integrity_test.ts]
 */
import { loadRepoSkillCatalog } from "@exaix/testing";

/** Every skill id the runtime catalog resolves, across every root. */
export async function readRuntimeSkillIds(): Promise<Set<string>> {
  return new Set((await loadRepoSkillCatalog()).keys());
}
