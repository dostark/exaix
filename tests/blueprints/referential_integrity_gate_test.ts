/**
 * @module ReferentialIntegrityGateTest
 * @path tests/blueprints/referential_integrity_gate_test.ts
 * @description Phase 131 Step 9 — referential-integrity + identity-role
 *   conformance gate. Validates that every identity's default_skills resolve
 *   to loadable .skill.md files, its capabilities/permitted_tools match its
 *   role, and the gate FAILS CLOSED on a dangling skill reference, wrong
 *   skills, or over-privileged tools.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @std/yaml, @exaix/core]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { McpToolName } from "@exaix/core";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Identities");
const SKILLS_DIR = join(REPO_ROOT, "Blueprints", "Skills");

// ── Const helpers ───────────────────────────────────────────────────

/** All valid McpToolName values for permitted_tools validation. */
const VALID_MCP_TOOL_NAMES = new Set(
  Object.values(McpToolName) as string[],
);

/** Destructive tools that read-only roles must not carry. */
const DESTRUCTIVE_TOOLS = new Set([
  "write_file",
  "delete_file",
  "run_command",
  "patch_file",
  "move_file",
  "create_directory",
]);

/**
 * Role-required default_skills matrix. Each identity must declare these
 * skills (beyond the universal `response-contract`).
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
  "research-synthesizer": ["research-methodology", "portal-grounding"],
};

/** Identities whose role is analysis/evaluation — no destructive tools. */
const READ_ONLY_IDENTITIES = new Set([
  "code-analyst",
  "product-manager",
  "performance-engineer",
  "quality-judge",
  "voting-judge",
]);

// ── Helpers ──────────────────────────────────────────────────────────

interface IIdentityFrontmatter {
  identity_id?: string;
  capabilities?: string[];
  default_skills?: string[];
  permitted_tools?: string[];
}

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

function listActiveIdentityIds(): string[] {
  const ids: string[] = [];
  for (const e of Deno.readDirSync(IDENTITIES_DIR)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    ids.push(e.name.replace(/\.md$/, ""));
  }
  return ids.sort();
}

function loadActiveIdentities(): Array<{ id: string; fm: IIdentityFrontmatter }> {
  const out: Array<{ id: string; fm: IIdentityFrontmatter }> = [];
  for (const id of listActiveIdentityIds()) {
    const fm = readRawFrontmatter(join(IDENTITIES_DIR, `${id}.md`));
    assertExists(fm, `${id}: must have YAML frontmatter`);
    out.push({ id, fm: fm as IIdentityFrontmatter });
  }
  return out;
}

// ── 1. Referential-integrity: every default_skills resolves ──────────

Deno.test({
  name: "[step9/integrity-gate] all default_skills references resolve to existent .skill.md files — FAILS CLOSED",
  fn() {
    const identities = loadActiveIdentities();
    const dangling: Array<{ id: string; skill: string }> = [];

    for (const { id, fm } of identities) {
      const skills = fm.default_skills ?? [];
      for (const s of skills) {
        const skillPath = join(SKILLS_DIR, `${s}.skill.md`);
        try {
          Deno.statSync(skillPath);
        } catch {
          dangling.push({ id, skill: s });
        }
      }
    }

    assert(
      dangling.length === 0,
      dangling.length > 0
        ? `Dangling skill references (${dangling.length}):\n${
          dangling.map((d) => `  ${d.id}: → "${d.skill}"`).join("\n")
        }`
        : "All default_skills resolve to existent .skill.md files",
    );
  },
});

// ── 2. FAILS CLOSED: dangling skill ref on a synthetic identity ──────

Deno.test({
  name: "[step9/integrity-gate] a dangling skill reference is detected — FAILS CLOSED",
  fn() {
    const dangling = "non-existent-skill-that-should-not-exist";
    const skillPath = join(SKILLS_DIR, `${dangling}.skill.md`);
    let fileExists = true;
    try {
      Deno.statSync(skillPath);
    } catch {
      fileExists = false;
    }
    assertEquals(fileExists, false, `Precondition: "${dangling}" must not have a .skill.md file`);

    // Simulate the gate check
    const badIdentity = { id: "__test_dangling_ref", fm: { default_skills: [dangling] } };
    const skills = badIdentity.fm.default_skills ?? [];
    const missing = skills.filter((s: string) => {
      try {
        Deno.statSync(join(SKILLS_DIR, `${s}.skill.md`));
        return false;
      } catch {
        return true;
      }
    });

    assertEquals(
      missing.length > 0,
      true,
      "Gate must detect a dangling skill reference",
    );
    assertEquals(
      missing[0],
      dangling,
      `Gate must identify the exact dangling skill "${dangling}"`,
    );
  },
});

// ── 3. Role-matrix conformance: every identity has role-required skills ─

Deno.test({
  name: "[step9/integrity-gate] every identity declares its role-required default_skills — FAILS CLOSED",
  fn() {
    const identities = loadActiveIdentities();
    const missing: Array<{ id: string; skill: string }> = [];

    for (const { id, fm } of identities) {
      const required = ROLE_REQUIRED_SKILLS[id];
      assert(
        required !== undefined,
        `${id}: no role-required entry in the identity-role matrix`,
      );
      const declared = new Set(fm.default_skills ?? []);
      for (const s of required) {
        if (!declared.has(s)) {
          missing.push({ id, skill: s });
        }
      }
    }

    assert(
      missing.length === 0,
      missing.length > 0
        ? `Identities missing role-required skills:\n${
          missing.map((m) => `  ${m.id}: missing "${m.skill}"`).join("\n")
        }`
        : "All identities declare role-required default_skills",
    );
  },
});

// ── 4. FAILS CLOSED: wrong skills on synthetic identity ──────────────

Deno.test({
  name: "[step9/integrity-gate] a wrong-skills identity is caught — FAILS CLOSED",
  fn() {
    // A synthetic identity that should NOT have the role-required skill
    const badIdentity: { id: string; fm: { default_skills: string[] } } = {
      id: "__test_wrong_skills_default",
      fm: { default_skills: [] },
    };
    const required: string[] = ROLE_REQUIRED_SKILLS["default"] ?? ["portal-grounding"];
    const declared = new Set(badIdentity.fm.default_skills);
    const missing = required.filter((s) => !declared.has(s));

    assertEquals(
      missing.length > 0,
      true,
      "Gate must detect an identity missing role-required skills",
    );
    assertEquals(
      missing.includes("portal-grounding"),
      true,
      "Gate must identify portal-grounding as the missing skill for default role",
    );
  },
});

// ── 5. Least-privilege: read-only identities carry no destructive tools ─

Deno.test({
  name: "[step9/integrity-gate] read-only identities carry no destructive permitted_tools — FAILS CLOSED",
  fn() {
    const identities = loadActiveIdentities();
    const violations: Array<{ id: string; tool: string }> = [];

    for (const { id, fm } of identities) {
      if (!READ_ONLY_IDENTITIES.has(id)) continue;
      const tools = fm.permitted_tools ?? [];
      for (const t of tools) {
        if (DESTRUCTIVE_TOOLS.has(t)) {
          violations.push({ id, tool: t });
        }
      }
    }

    assert(
      violations.length === 0,
      violations.length > 0
        ? `Read-only identities with destructive tools:\n${violations.map((v) => `  ${v.id}: "${v.tool}"`).join("\n")}`
        : "All read-only identities carry no destructive tools",
    );
  },
});

// ── 6. FAILS CLOSED: over-privileged synthetic identity ──────────────

Deno.test({
  name: "[step9/integrity-gate] an over-privileged read-only identity is caught — FAILS CLOSED",
  fn() {
    const destructive = [...DESTRUCTIVE_TOOLS][0]; // e.g. "write_file"
    const badIdentity = { id: "__test_overprivileged", fm: { permitted_tools: [destructive] } };
    const tools = badIdentity.fm.permitted_tools ?? [];
    const violations = tools.filter((t: string) => DESTRUCTIVE_TOOLS.has(t));

    assertEquals(
      violations.length > 0,
      true,
      `Gate must detect "${destructive}" in a read-only identity's permitted_tools`,
    );
    assertEquals(
      violations[0],
      destructive,
      `Gate must identify the exact prohibited tool "${destructive}"`,
    );
  },
});

// ── 7. capabilities behavioral-only gate ─────────────────────────────

Deno.test({
  name: "[step9/integrity-gate] no identity has McpToolName values in capabilities — FAILS CLOSED",
  fn() {
    const identities = loadActiveIdentities();
    const violations: Array<{ id: string; capability: string }> = [];

    for (const { id, fm } of identities) {
      const caps = fm.capabilities ?? [];
      for (const c of caps) {
        if (VALID_MCP_TOOL_NAMES.has(c)) {
          violations.push({ id, capability: c });
        }
      }
    }

    assert(
      violations.length === 0,
      violations.length > 0
        ? `Identities with tool names in capabilities:\n${
          violations.map((v) => `  ${v.id}: "${v.capability}"`).join("\n")
        }`
        : "All capabilities are behavioral-only",
    );
  },
});
