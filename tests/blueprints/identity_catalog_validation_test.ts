/**
 * @module IdentityCatalogValidationTest
 * @path tests/blueprints/identity_catalog_validation_test.ts
 * @description Phase 131 Step 6 — validates every active identity's capabilities are
 *   behavioral-only (no McpToolName/ToolName values), default_skills include the
 *   role-required core skill, and read-only identities carry no destructive tools in
 *   permitted_tools (least-privilege). This is a catalog-wide structural integrity
 *   gate; it reads all identity YAML frontmatter files.
 * @architectural-layer Skill (test)
 * @dependencies [@std/assert, @std/path, @std/yaml]
 * @related-files [packages/core/src/types/enums.ts]
 */

import { assert } from "@std/assert";
import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const IDENTITIES_DIR = resolve(new URL("../../Blueprints/Identities/", import.meta.url).pathname);

/** All known tool name values from McpToolName and ToolName enums. */
const KNOWN_TOOL_NAMES = new Set([
  "read_file",
  "write_file",
  "run_command",
  "list_directory",
  "search_files",
  "create_directory",
  "patch_file",
  "delete_file",
  "move_file",
  "git_create_branch",
  "git_commit",
  "git_status",
  "git_log",
  "git_worktree",
  "exaix_create_request",
  "exaix_list_plans",
  "exaix_approve_plan",
  "exaix_query_journal",
  "fetch_url",
  "grep_search",
  "git_info",
  "deno_task",
  "copy_file",
  "git_checkout",
  "git_merge",
  "git_push",
  "git_pull",
  "git_stash",
]);

/** Destructive tool names that read-only identities must not carry. */
const DESTRUCTIVE_TOOLS = new Set([
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
const ROLE_REQUIRED_SKILLS: Record<string, string[]> = {
  "default": ["portal-grounding"],
  "mock-agent": ["portal-grounding"],
  "code-analyst": ["code-review", "typescript-patterns", "portal-grounding"],
  "product-manager": ["portal-grounding"],
  "software-architect": ["exaix-conventions", "typescript-patterns", "portal-grounding"],
  "senior-coder": ["typescript-patterns", "error-handling", "code-review", "portal-grounding"],
  "dogfood-coder": ["tdd-methodology", "exaix-conventions", "portal-grounding"],
  "qa-engineer": ["tdd-methodology", "error-handling", "portal-grounding"],
  "test-engineer": ["response-contract", "tdd-methodology", "error-handling", "portal-grounding"],
  "security-expert": ["security-first", "code-review", "portal-grounding"],
  "performance-engineer": ["code-review", "portal-grounding"],
  "technical-writer": ["documentation-driven", "portal-grounding"],
  "quality-judge": ["code-review", "portal-grounding"],
  "voting-judge": ["code-review", "portal-grounding"],
};

/** Identities whose role is analysis/evaluation — no destructive tools. */
const READ_ONLY_IDENTITIES = new Set([
  "code-analyst",
  "product-manager",
  "performance-engineer",
  "quality-judge",
  "voting-judge",
]);

interface IIdentityFrontmatter {
  identity_id?: string;
  capabilities?: string[];
  default_skills?: string[];
  permitted_tools?: string[];
}

/** Load all active identity files (non-example, non-template, non-README). */
function loadActiveIdentities(): Array<{ id: string; fm: IIdentityFrontmatter }> {
  const out: Array<{ id: string; fm: IIdentityFrontmatter }> = [];
  for (const e of Deno.readDirSync(IDENTITIES_DIR)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    const content = Deno.readTextFileSync(join(IDENTITIES_DIR, e.name));
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) throw new Error(`malformed identity ${e.name}`);
    const fm = parseYaml(m[1]) as IIdentityFrontmatter;
    const id = e.name.replace(/\.md$/, "");
    if (fm.identity_id && fm.identity_id !== id) {
      throw new Error(`identity_id mismatch in ${e.name}: frontmatter says "${fm.identity_id}"`);
    }
    out.push({ id, fm });
  }
  return out;
}

Deno.test({
  name: "[step6] every identity's capabilities are behavioral-only (no tool names)",
  fn() {
    const identities = loadActiveIdentities();
    for (const { id, fm } of identities) {
      const caps = fm.capabilities ?? [];
      for (const c of caps) {
        assert(
          !KNOWN_TOOL_NAMES.has(c),
          `${id}: capability "${c}" is a tool name, not a behavioral tag`,
        );
      }
    }
  },
});

Deno.test({
  name: "[step6] every identity declares its role-required default_skills",
  fn() {
    const identities = loadActiveIdentities();
    const required = ROLE_REQUIRED_SKILLS;
    for (const { id, fm } of identities) {
      const expected = required[id];
      assert(expected !== undefined, `${id}: no role-required entry in the identity-role matrix`);
      const skills = new Set(fm.default_skills ?? []);
      for (const s of expected) {
        assert(
          skills.has(s),
          `${id}: missing role-required skill "${s}" in default_skills`,
        );
      }
    }
  },
});

Deno.test({
  name: "[step6] read-only identities carry no destructive tools in permitted_tools",
  fn() {
    const identities = loadActiveIdentities();
    for (const { id, fm } of identities) {
      if (!READ_ONLY_IDENTITIES.has(id)) continue;
      const tools = fm.permitted_tools ?? [];
      for (const t of tools) {
        assert(
          !DESTRUCTIVE_TOOLS.has(t),
          `${id}: read-only identity has destructive tool "${t}" in permitted_tools`,
        );
      }
    }
  },
});
