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
  // Phase 142 Step 17: this floor was rewritten when default_skills were pruned from 68
  // entries to 33. Under the always-concatenate model every default is unconditional prompt
  // weight on every request, so a default must be something the identity needs EVERY time.
  // Situational skills (language-, task-, phase-specific) were removed and are reached by
  // trigger matching instead — `portal-grounding` in particular, which was a default on 14
  // of 15 identities despite only applying when a request names a portal, and which declares
  // `portal`/`context`/`grounding` keyword triggers that fire exactly then.
  "default": ["response-contract"],
  "mock-agent": ["response-contract"],
  "code-analyst": ["response-contract-code-analysis", "code-review"],
  "product-manager": ["response-contract", "requirements-analysis"],
  "software-architect": ["response-contract", "architecture-review"],
  "senior-coder": ["response-contract", "tdd-methodology"],
  "dogfood-developer": ["response-contract", "exaix-conventions", "tdd-methodology"],
  "qa-engineer": ["response-contract-qa", "tdd-methodology"],
  "test-engineer": ["response-contract", "tdd-methodology"],
  "security-expert": ["response-contract-security-analysis", "security-first"],
  "performance-engineer": ["response-contract-performance", "performance-analysis"],
  "technical-writer": ["response-contract", "documentation-driven"],
  "quality-judge": ["response-contract-judge", "verdict-rubric"],
  "voting-judge": ["response-contract-judge", "verdict-rubric"],
  "research-synthesizer": ["response-contract", "research-methodology"],
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
