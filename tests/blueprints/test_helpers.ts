/**
 * @module BlueprintTestHelpers
 * @path tests/blueprints/test_helpers.ts
 * @description Shared test data and helpers for Blueprint identity catalog tests.
 *   Extracted from identity_catalog_validation_test.ts, identity_catalog_load_test.ts,
 *   and referential_integrity_gate_test.ts to reduce test-file duplication.
 * @architectural-layer Test (helpers)
 * @dependencies [@std/path, @std/yaml]
 * @related-files [tests/blueprints/identity_catalog_validation_test.ts,
 *   tests/blueprints/identity_catalog_load_test.ts,
 *   tests/blueprints/referential_integrity_gate_test.ts]
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

export interface IIdentityFrontmatter {
  identity_id?: string;
  capabilities?: string[];
  default_skills?: string[];
  permitted_tools?: string[];
}

export interface IRawFrontmatter {
  identity_id?: string;
  name?: string;
  model?: string;
  capabilities?: string[];
  default_skills?: string[];
  permitted_tools?: string[];
  created?: string;
  created_by?: string;
  version?: string;
  description?: string;
}

export const REPO_ROOT = join(import.meta.dirname!, "..", "..");
export const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Identities");
export const SKILLS_DIR = join(REPO_ROOT, "Blueprints", "Skills");
export const FRAGMENTS_DIR = join(REPO_ROOT, "Blueprints", "Fragments");

/** Destructive tool names that read-only identities must not carry. */
export const DESTRUCTIVE_TOOLS = new Set([
  "write_file",
  "delete_file",
  "run_command",
  "patch_file",
  "move_file",
  "create_directory",
]);

/**
 * Identity-role matrix: maps identity_id → role-required default_skills.
 * Every identity must have at least one role-specific skill listed here
 * (beyond the universal response-contract added in Step 7).
 */
export const ROLE_REQUIRED_SKILLS: Record<string, string[]> = {
  "default": ["portal-grounding"],
  "mock-agent": ["portal-grounding"],
  "code-analyst": ["code-review", "typescript-patterns", "portal-grounding"],
  "product-manager": ["portal-grounding"],
  "software-architect": ["exaix-conventions", "typescript-patterns", "portal-grounding"],
  "senior-coder": ["fix-bug"],
  "dogfood-developer": ["tdd-methodology", "exaix-conventions", "portal-grounding"],
  "qa-engineer": ["tdd-methodology", "error-handling", "portal-grounding"],
  "test-engineer": ["response-contract", "tdd-methodology", "error-handling", "portal-grounding"],
  "security-expert": ["security-first", "code-review", "portal-grounding"],
  "performance-engineer": ["code-review", "portal-grounding"],
  "technical-writer": ["documentation-driven", "portal-grounding"],
  "quality-judge": ["code-review", "portal-grounding"],
  "voting-judge": ["code-review", "portal-grounding"],
  "research-synthesizer": ["research-methodology", "portal-grounding"],
};

/** Identities whose role is analysis/evaluation — no destructive tools. */
export const READ_ONLY_IDENTITIES = new Set([
  "code-analyst",
  "product-manager",
  "performance-engineer",
  "quality-judge",
  "voting-judge",
]);

export function readRawFrontmatter(filePath: string): IRawFrontmatter | null {
  const content = Deno.readTextFileSync(filePath);
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  return parseYaml(m[1]) as IRawFrontmatter;
}
