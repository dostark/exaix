/**
 * @module AgentRoleCatalogLoadTest
 * @path tests/blueprints/agent_role_catalog_load_test.ts
 * @description Phase 131 Step 9 — catalog-wide load+validate integration test.
 *   Walks every active agent role under Blueprints/Agents/ (the separate
 *   examples/ and templates/ directories were retired in the catalog
 *   reconciliation), loads through IBlueprintLoader, and validates: schema passes,
 *   default_skills resolve, permitted_tools are valid McpToolName, capabilities
 *   are behavioral-only, no unresolved {{include:}}.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @std/yaml, @exaix/core/blueprint]
 */

import { assertEquals } from "@std/assert";
import { basename, join } from "@std/path";
import { McpToolName, ToolName } from "@exaix/core";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { AGENTS_DIR, readRawFrontmatter, SKILLS_DIR } from "./test_helpers.ts";

// Helpers

/** Names of all valid tool names (McpToolName ∪ ToolName). */
const VALID_TOOL_NAMES = new Set([
  ...Object.values(McpToolName) as string[],
  ...Object.values(ToolName) as string[],
]);

/**
 * List active agent role filenames (non-example, non-template, non-README .md files).
 */
function listActiveAgentRoles(): string[] {
  const ids: string[] = [];
  for (const e of Deno.readDirSync(AGENTS_DIR)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    ids.push(basename(e.name, ".md"));
  }
  return ids.sort();
}

// 1. Active agent role load via IBlueprintLoader

Deno.test({
  name: "[step9/catalog-load] every active agent role loads through IBlueprintLoader with valid frontmatter",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_DIR });
    const activeIds = listActiveAgentRoles();
    const failures: Array<{ id: string; error: string }> = [];

    for (const id of activeIds) {
      try {
        const bp = await loader.load(id);
        if (!bp) {
          failures.push({ id, error: "blueprint returned null" });
        }
      } catch (e) {
        failures.push({ id, error: String(e) });
      }
    }

    if (failures.length > 0) {
      console.log("\nBlueprintLoader load failures:");
      for (const f of failures) {
        console.log(`  ${f.id}: ${f.error}`);
      }
    }

    assertEquals(failures.length, 0, `${failures.length} active agent role(s) failed to load via IBlueprintLoader`);
  },
});

// default_skills resolve to loadable .skill.md files

Deno.test({
  name: "[step9/catalog-load] all agent role default_skills resolve to existing .skill.md files",
  fn() {
    const activeIds = listActiveAgentRoles();
    const missingSkills: Array<{ agent_role: string; skill: string }> = [];

    for (const id of activeIds) {
      const fm = readRawFrontmatter(join(AGENTS_DIR, `${id}.md`));
      if (!fm) continue;
      const skills = (fm.default_skills ?? []) as string[];
      for (const s of skills) {
        const skillPath = join(SKILLS_DIR, `${s}.skill.md`);
        try {
          Deno.statSync(skillPath);
        } catch {
          missingSkills.push({ agent_role: id, skill: s });
        }
      }
    }

    if (missingSkills.length > 0) {
      console.log("\nDefault skills that do not resolve to a .skill.md file:");
      for (const m of missingSkills) {
        console.log(`  ${m.agent_role}: → ${m.skill}`);
      }
    }

    assertEquals(
      missingSkills.length,
      0,
      `${missingSkills.length} default_skills references do not resolve to a .skill.md file`,
    );
  },
});

// 5. capabilities are behavioral-only (no tool names)

Deno.test({
  name: "[step9/catalog-load] every agent role's capabilities are behavioral-only (no tool-name values)",
  fn() {
    const activeIds = listActiveAgentRoles();
    const violations: Array<{ agent_role: string; capability: string }> = [];

    for (const id of activeIds) {
      const fm = readRawFrontmatter(join(AGENTS_DIR, `${id}.md`));
      if (!fm) continue;
      const caps = (fm.capabilities ?? []) as string[];
      for (const c of caps) {
        if (VALID_TOOL_NAMES.has(c)) {
          violations.push({ agent_role: id, capability: c });
        }
      }
    }

    if (violations.length > 0) {
      console.log("\nCapabilities that are tool names (should be behavioral-only):");
      for (const v of violations) {
        console.log(`  ${v.agent_role}: capability "${v.capability}" is an McpToolName`);
      }
    }

    assertEquals(violations.length, 0, `${violations.length} agent role(s) have tool names in capabilities`);
  },
});

// every active agent role opts into ReActLoopStrategy (Ledger:EXECUTION_STRATEGY_NO_TOOLS)

/** mock-agent declares no capabilities at all — test-only agent role, not a real execution path. */
const AGENST_EXEMPT_FROM_REACT = new Set(["mock-agent"]);

Deno.test({
  name:
    "fix(agent-role-catalog): every active agent role (except mock-agent) declares react in capabilities so AgentOrchestrator dispatches to the multi-turn ReActLoopStrategy instead of the single-shot LegacyAgentStrategy",
  fn() {
    const activeIds = listActiveAgentRoles();
    const missing: string[] = [];

    for (const id of activeIds) {
      if (AGENST_EXEMPT_FROM_REACT.has(id)) continue;
      const fm = readRawFrontmatter(join(AGENTS_DIR, `${id}.md`));
      const caps = fm?.capabilities ?? [];
      if (!caps.includes("react")) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      console.log('\nAgent roles missing "react" in capabilities:');
      for (const id of missing) {
        console.log(`  ${id}`);
      }
    }

    assertEquals(
      missing.length,
      0,
      `${missing.length} agent role(s) missing "react" in capabilities — without it, ` +
        "AgentOrchestrator.executeStep falls through to LegacyAgentStrategy, which makes a " +
        "single blind provider.generate() call with no tool-result feedback loop " +
        "(Ledger:EXECUTION_STRATEGY_NO_TOOLS)",
    );
  },
});

// 6. permitted_tools are valid tool-name values

Deno.test({
  name: "[step9/catalog-load] permitted_tools values are valid McpToolName or ToolName members",
  fn() {
    const activeIds = listActiveAgentRoles();
    const invalid: Array<{ agent_role: string; tool: string }> = [];

    for (const id of activeIds) {
      const fm = readRawFrontmatter(join(AGENTS_DIR, `${id}.md`));
      if (!fm) continue;
      const tools = (fm.permitted_tools ?? []) as string[];
      for (const t of tools) {
        if (!VALID_TOOL_NAMES.has(t)) {
          invalid.push({ agent_role: id, tool: t });
        }
      }
    }

    if (invalid.length > 0) {
      console.log("\npermitted_tools values not in McpToolName or ToolName enum:");
      for (const v of invalid) {
        console.log(`  ${v.agent_role}: "${v.tool}" is not a valid tool name`);
      }
    }

    assertEquals(
      invalid.length,
      0,
      `${invalid.length} permitted_tools value(s) are not valid McpToolName or ToolName members`,
    );
  },
});

// 7. No unresolved {{include:}} after load

Deno.test({
  name:
    "[step9/catalog-load] no unresolved {{include:}} remains in loaded system prompts (active agent roles only — examples/templates have no includes)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_DIR });
    const activeIds = listActiveAgentRoles();
    const unresolved: Array<{ agent_role: string }> = [];

    for (const id of activeIds) {
      try {
        const bp = await loader.load(id);
        if (bp && bp.systemPrompt.includes("{{include:")) {
          unresolved.push({ agent_role: id });
        }
      } catch {
        // Skip agent roles that fail to load (permitted_tools schema issues)
      }
    }

    if (unresolved.length > 0) {
      console.log("\nAgent roles with unresolved {{include:}} in systemPrompt:");
      for (const u of unresolved) {
        console.log(`  ${u.agent_role}`);
      }
    }

    assertEquals(unresolved.length, 0, `${unresolved.length} agent role(s) have unresolved {{include:}}`);
  },
});

// 8. Template count consistency
