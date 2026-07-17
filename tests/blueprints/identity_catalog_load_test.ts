/**
 * @module IdentityCatalogLoadTest
 * @path tests/blueprints/identity_catalog_load_test.ts
 * @description Phase 131 Step 9 — catalog-wide load+validate integration test.
 *   Walks every active identity under Blueprints/Identities/ (the separate
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
import { IDENTITIES_DIR, readRawFrontmatter, SKILLS_DIR } from "./test_helpers.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Names of all valid tool names (McpToolName ∪ ToolName). */
const VALID_TOOL_NAMES = new Set([
  ...Object.values(McpToolName) as string[],
  ...Object.values(ToolName) as string[],
]);

/**
 * List active identity filenames (non-example, non-template, non-README .md files).
 */
function listActiveIdentities(): string[] {
  const ids: string[] = [];
  for (const e of Deno.readDirSync(IDENTITIES_DIR)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    ids.push(basename(e.name, ".md"));
  }
  return ids.sort();
}

// ── 1. Active identity load via IBlueprintLoader ──────────────────────

Deno.test({
  name: "[step9/catalog-load] every active identity loads through IBlueprintLoader with valid frontmatter",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_DIR });
    const activeIds = listActiveIdentities();
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

    assertEquals(failures.length, 0, `${failures.length} active identity/ies failed to load via IBlueprintLoader`);
  },
});

// (The separate examples/ and templates/ directories were retired in the
// Phase 131 catalog reconciliation: example stubs were merged into / promoted to
// concrete identities, and templates were converted to skills + the --from CLI.
// The catalog is now a flat set of concrete identities, covered by the tests above
// and below.)

// ── default_skills resolve to loadable .skill.md files ───────────────

Deno.test({
  name: "[step9/catalog-load] all identity default_skills resolve to existing .skill.md files",
  fn() {
    const activeIds = listActiveIdentities();
    const missingSkills: Array<{ identity: string; skill: string }> = [];

    for (const id of activeIds) {
      const fm = readRawFrontmatter(join(IDENTITIES_DIR, `${id}.md`));
      if (!fm) continue;
      const skills = (fm.default_skills ?? []) as string[];
      for (const s of skills) {
        const skillPath = join(SKILLS_DIR, `${s}.skill.md`);
        try {
          Deno.statSync(skillPath);
        } catch {
          missingSkills.push({ identity: id, skill: s });
        }
      }
    }

    if (missingSkills.length > 0) {
      console.log("\nDefault skills that do not resolve to a .skill.md file:");
      for (const m of missingSkills) {
        console.log(`  ${m.identity}: → ${m.skill}`);
      }
    }

    assertEquals(
      missingSkills.length,
      0,
      `${missingSkills.length} default_skills references do not resolve to a .skill.md file`,
    );
  },
});

// ── 5. capabilities are behavioral-only (no tool names) ──────────────

Deno.test({
  name: "[step9/catalog-load] every identity's capabilities are behavioral-only (no tool-name values)",
  fn() {
    const activeIds = listActiveIdentities();
    const violations: Array<{ identity: string; capability: string }> = [];

    for (const id of activeIds) {
      const fm = readRawFrontmatter(join(IDENTITIES_DIR, `${id}.md`));
      if (!fm) continue;
      const caps = (fm.capabilities ?? []) as string[];
      for (const c of caps) {
        if (VALID_TOOL_NAMES.has(c)) {
          violations.push({ identity: id, capability: c });
        }
      }
    }

    if (violations.length > 0) {
      console.log("\nCapabilities that are tool names (should be behavioral-only):");
      for (const v of violations) {
        console.log(`  ${v.identity}: capability "${v.capability}" is an McpToolName`);
      }
    }

    assertEquals(violations.length, 0, `${violations.length} identity/ies have tool names in capabilities`);
  },
});

// ── every active identity opts into ReActLoopStrategy (Ledger:EXECUTION_STRATEGY_NO_TOOLS) ──

/** mock-agent declares no capabilities at all — test-only identity, not a real execution path. */
const IDENTITIES_EXEMPT_FROM_REACT = new Set(["mock-agent"]);

Deno.test({
  name:
    "fix(identity-catalog): every active identity (except mock-agent) declares react in capabilities so AgentOrchestrator dispatches to the multi-turn ReActLoopStrategy instead of the single-shot LegacyAgentStrategy",
  fn() {
    const activeIds = listActiveIdentities();
    const missing: string[] = [];

    for (const id of activeIds) {
      if (IDENTITIES_EXEMPT_FROM_REACT.has(id)) continue;
      const fm = readRawFrontmatter(join(IDENTITIES_DIR, `${id}.md`));
      const caps = fm?.capabilities ?? [];
      if (!caps.includes("react")) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      console.log('\nIdentities missing "react" in capabilities:');
      for (const id of missing) {
        console.log(`  ${id}`);
      }
    }

    assertEquals(
      missing.length,
      0,
      `${missing.length} identity/ies missing "react" in capabilities — without it, ` +
        "AgentOrchestrator.executeStep falls through to LegacyAgentStrategy, which makes a " +
        "single blind provider.generate() call with no tool-result feedback loop " +
        "(Ledger:EXECUTION_STRATEGY_NO_TOOLS)",
    );
  },
});

// ── 6. permitted_tools are valid tool-name values ────────────────────

Deno.test({
  name: "[step9/catalog-load] permitted_tools values are valid McpToolName or ToolName members",
  fn() {
    const activeIds = listActiveIdentities();
    const invalid: Array<{ identity: string; tool: string }> = [];

    for (const id of activeIds) {
      const fm = readRawFrontmatter(join(IDENTITIES_DIR, `${id}.md`));
      if (!fm) continue;
      const tools = (fm.permitted_tools ?? []) as string[];
      for (const t of tools) {
        if (!VALID_TOOL_NAMES.has(t)) {
          invalid.push({ identity: id, tool: t });
        }
      }
    }

    if (invalid.length > 0) {
      console.log("\npermitted_tools values not in McpToolName or ToolName enum:");
      for (const v of invalid) {
        console.log(`  ${v.identity}: "${v.tool}" is not a valid tool name`);
      }
    }

    assertEquals(
      invalid.length,
      0,
      `${invalid.length} permitted_tools value(s) are not valid McpToolName or ToolName members`,
    );
  },
});

// ── 7. No unresolved {{include:}} after load ─────────────────────────

Deno.test({
  name:
    "[step9/catalog-load] no unresolved {{include:}} remains in loaded system prompts (active identities only — examples/templates have no includes)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_DIR });
    const activeIds = listActiveIdentities();
    const unresolved: Array<{ identity: string }> = [];

    for (const id of activeIds) {
      try {
        const bp = await loader.load(id);
        if (bp && bp.systemPrompt.includes("{{include:")) {
          unresolved.push({ identity: id });
        }
      } catch {
        // Skip identities that fail to load (permitted_tools schema issues)
      }
    }

    if (unresolved.length > 0) {
      console.log("\nIdentities with unresolved {{include:}} in systemPrompt:");
      for (const u of unresolved) {
        console.log(`  ${u.identity}`);
      }
    }

    assertEquals(unresolved.length, 0, `${unresolved.length} identity/ies have unresolved {{include:}}`);
  },
});

// ── 8. Template count consistency ────────────────────────────────────
