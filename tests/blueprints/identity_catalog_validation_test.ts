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
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  DESTRUCTIVE_TOOLS,
  IDENTITIES_DIR,
  type IIdentityFrontmatter,
  READ_ONLY_IDENTITIES,
  ROLE_REQUIRED_SKILLS,
} from "./test_helpers.ts";

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
