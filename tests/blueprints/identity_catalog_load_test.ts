/**
 * @module IdentityCatalogLoadTest
 * @path tests/blueprints/identity_catalog_load_test.ts
 * @description Phase 131 Step 9 — catalog-wide load+validate integration test.
 *   Walks every active identity under Blueprints/Identities/ (the separate
 *   examples/ and templates/ directories were retired in the catalog
 *   reconciliation), loads through BlueprintLoader, and validates: schema passes,
 *   default_skills resolve, permitted_tools are valid McpToolName, capabilities
 *   are behavioral-only, no unresolved {{include:}}.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @std/yaml, @exaix/core/blueprint]
 */

import { assertEquals } from "@std/assert";
import { basename, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { McpToolName, ToolName } from "@exaix/core";
import { BlueprintLoader } from "@exaix/core/blueprint";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Identities");
const SKILLS_DIR = join(REPO_ROOT, "Blueprints", "Skills");

// ── Helpers ──────────────────────────────────────────────────────────

/** Names of all valid tool names (McpToolName ∪ ToolName). */
const VALID_TOOL_NAMES = new Set([
  ...Object.values(McpToolName) as string[],
  ...Object.values(ToolName) as string[],
]);

/**
 * Read and return the raw YAML frontmatter object from a blueprint file.
 * Returns null if the file has no YAML frontmatter.
 */
interface IRawFrontmatter {
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

function readRawFrontmatter(filePath: string): IRawFrontmatter | null {
  const content = Deno.readTextFileSync(filePath);
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  return parseYaml(m[1]) as IRawFrontmatter;
}

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

// ── 1. Active identity load via BlueprintLoader ──────────────────────

Deno.test({
  name: "[step9/catalog-load] every active identity loads through BlueprintLoader with valid frontmatter",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_DIR });
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

    assertEquals(failures.length, 0, `${failures.length} active identity/ies failed to load via BlueprintLoader`);
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
    const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_DIR });
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
