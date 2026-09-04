/**
 * @module ReferentialIntegrityGateTest
 * @path tests/blueprints/referential_integrity_gate_test.ts
 * @description Phase 131 Step 9 — referential-integrity + agent-role
 *   conformance gate. Validates that every agent role's default_skills resolve
 *   to loadable .skill.md files, its capabilities/permitted_tools match its
 *   role, and the gate FAILS CLOSED on a dangling skill reference, wrong
 *   skills, or over-privileged tools.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @std/yaml, @exaix/core]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { McpToolName } from "@exaix/core";
import {
  AGENTS_DIR,
  DESTRUCTIVE_TOOLS,
  type IAgentRoleFrontmatter,
  READ_ONLY_AGENT_ROLES,
  readRawFrontmatter,
  ROLE_REQUIRED_SKILLS,
  SKILLS_DIR,
} from "./test_helpers.ts";

// Const helpers

/** All valid McpToolName values for permitted_tools validation. */
const VALID_MCP_TOOL_NAMES = new Set(
  Object.values(McpToolName) as string[],
);

// Helpers

function listActiveAgentRoleIds(): string[] {
  const ids: string[] = [];
  for (const e of Deno.readDirSync(AGENTS_DIR)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    ids.push(e.name.replace(/\.md$/, ""));
  }
  return ids.sort();
}

function loadActiveAgentRoles(): Array<{ id: string; fm: IAgentRoleFrontmatter }> {
  const out: Array<{ id: string; fm: IAgentRoleFrontmatter }> = [];
  for (const id of listActiveAgentRoleIds()) {
    const fm = readRawFrontmatter(join(AGENTS_DIR, `${id}.md`));
    assertExists(fm, `${id}: must have YAML frontmatter`);
    out.push({ id, fm: fm as IAgentRoleFrontmatter });
  }
  return out;
}

// 1. Referential-integrity: every default_skills resolves

Deno.test({
  name: "[step9/integrity-gate] all default_skills references resolve to existent .skill.md files — FAILS CLOSED",
  fn() {
    const agentRoles = loadActiveAgentRoles();
    const dangling: Array<{ id: string; skill: string }> = [];

    for (const { id, fm } of agentRoles) {
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

// 2. FAILS CLOSED: dangling skill ref on a synthetic agent role

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
    const badAgentRole = { id: "__test_dangling_ref", fm: { default_skills: [dangling] } };
    const skills = badAgentRole.fm.default_skills ?? [];
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

// ── 3. Role-matrix conformance: every agent role has role-required skills ─

Deno.test({
  name: "[step9/integrity-gate] every agent role declares its role-required default_skills — FAILS CLOSED",
  fn() {
    const agentRoles = loadActiveAgentRoles();
    const missing: Array<{ id: string; skill: string }> = [];

    for (const { id, fm } of agentRoles) {
      const required = ROLE_REQUIRED_SKILLS[id];
      assert(
        required !== undefined,
        `${id}: no role-required entry in the agent-role matrix`,
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
        ? `Agent roles missing role-required skills:\n${
          missing.map((m) => `  ${m.id}: missing "${m.skill}"`).join("\n")
        }`
        : "All agent roles declare role-required default_skills",
    );
  },
});

// 4. FAILS CLOSED: wrong skills on synthetic agent role

Deno.test({
  name: "[step9/integrity-gate] a wrong-skills agent role is caught — FAILS CLOSED",
  fn() {
    // A synthetic agent role that should NOT have the role-required skill
    const badAgentRole: { id: string; fm: { default_skills: string[] } } = {
      id: "__test_wrong_skills_default",
      fm: { default_skills: [] },
    };
    const required: string[] = ROLE_REQUIRED_SKILLS["default"] ?? [];
    const declared = new Set(badAgentRole.fm.default_skills);
    const missing = required.filter((s) => !declared.has(s));

    assertEquals(
      missing.length > 0,
      true,
      "Gate must detect an agent role missing role-required skills",
    );
    // Assert against the role matrix rather than a hardcoded skill name, since role requirements change.
    assertEquals(
      missing.sort(),
      [...required].sort(),
      "Gate must report every role-required skill the agent role failed to declare",
    );
  },
});

// ── 5. Least-privilege: read-only agent roles carry no destructive tools ─

Deno.test({
  name: "[step9/integrity-gate] read-only agent roles carry no destructive permitted_tools — FAILS CLOSED",
  fn() {
    const agentRoles = loadActiveAgentRoles();
    const violations: Array<{ id: string; tool: string }> = [];

    for (const { id, fm } of agentRoles) {
      if (!READ_ONLY_AGENT_ROLES.has(id)) continue;
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
        ? `Read-only agent roles with destructive tools:\n${violations.map((v) => `  ${v.id}: "${v.tool}"`).join("\n")}`
        : "All read-only agent roles carry no destructive tools",
    );
  },
});

// 6. FAILS CLOSED: over-privileged synthetic agent role

Deno.test({
  name: "[step9/integrity-gate] an over-privileged read-only agent role is caught — FAILS CLOSED",
  fn() {
    const destructive = [...DESTRUCTIVE_TOOLS][0]; // e.g. "write_file"
    const badAgentRole = { id: "__test_overprivileged", fm: { permitted_tools: [destructive] } };
    const tools = badAgentRole.fm.permitted_tools ?? [];
    const violations = tools.filter((t: string) => DESTRUCTIVE_TOOLS.has(t));

    assertEquals(
      violations.length > 0,
      true,
      `Gate must detect "${destructive}" in a read-only agent role's permitted_tools`,
    );
    assertEquals(
      violations[0],
      destructive,
      `Gate must identify the exact prohibited tool "${destructive}"`,
    );
  },
});

// 7. capabilities behavioral-only gate

Deno.test({
  name: "[step9/integrity-gate] no agent role has McpToolName values in capabilities — FAILS CLOSED",
  fn() {
    const agentRoles = loadActiveAgentRoles();
    const violations: Array<{ id: string; capability: string }> = [];

    for (const { id, fm } of agentRoles) {
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
        ? `Agent roles with tool names in capabilities:\n${
          violations.map((v) => `  ${v.id}: "${v.capability}"`).join("\n")
        }`
        : "All capabilities are behavioral-only",
    );
  },
});
