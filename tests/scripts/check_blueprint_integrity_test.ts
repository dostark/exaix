/**
 * @module CheckBlueprintIntegrityTest
 * @path tests/scripts/check_blueprint_integrity_test.ts
 * @description Tests for scripts/check_blueprint_integrity.ts — the catalog
 *   referential-integrity + anti-bloat gate. Verifies all four facets:
 *   (1) every flow `agent_role:` resolves to an existing agent role (no dangling),
 *   (2) every agent role `default_skills` entry resolves to an existing skill,
 *   (3) every agent role is referenced by >=1 flow (orphan agent roles, with the
 *   `default`/`mock-agent` system agent roles exempt), and (4) every skill is
 *   referenced by >=1 agent role (orphan skills). Each facet fails closed.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [scripts/check_blueprint_integrity.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { checkBlueprintIntegrity } from "../../scripts/check_blueprint_integrity.ts";

interface IFixtureAgentRole {
  id: string;
  model?: string;
  skills?: string[];
}

interface IFixtureFlow {
  id: string;
  agentRoles: string[];
  /** Optional subdirectory under Flows/ (tests recursive walk). */
  subdir?: string;
  /** Write as a `.flow.template.yaml` pattern template instead of `.flow.yaml`. */
  template?: boolean;
}

async function buildCatalog(opts: {
  agentRoles: IFixtureAgentRole[];
  skills: string[];
  flows: IFixtureFlow[];
}): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "bp_integrity_" });
  const idDir = join(root, "Agents");
  const skillDir = join(root, "Skills");
  const flowDir = join(root, "Flows");
  await ensureDir(idDir);
  await ensureDir(skillDir);
  await ensureDir(flowDir);

  for (const it of opts.agentRoles) {
    const fm = [
      `agent_role: "${it.id}"`,
      `name: "${it.id}"`,
      `model: "${it.model ?? "anthropic:claude"}"`,
      `default_skills: [${(it.skills ?? []).map((s) => `"${s}"`).join(", ")}]`,
    ].join("\n");
    await Deno.writeTextFile(join(idDir, `${it.id}.md`), `---\n${fm}\n---\n\n# ${it.id}\n`);
  }
  for (const s of opts.skills) {
    await Deno.writeTextFile(join(skillDir, `${s}.skill.md`), `---\nskill_id: "${s}"\n---\n\n# ${s}\n`);
  }
  for (const f of opts.flows) {
    const steps = f.agentRoles
      .map((id, i) => `  - id: step-${i}\n    type: agent\n    agent_role: ${id}`)
      .join("\n");
    const dir = f.subdir ? join(flowDir, f.subdir) : flowDir;
    await ensureDir(dir);
    const ext = f.template ? "flow.template.yaml" : "flow.yaml";
    await Deno.writeTextFile(
      join(dir, `${f.id}.${ext}`),
      `id: ${f.id}\nname: ${f.id}\ndescription: ${f.id}\nsteps:\n${steps}\noutput:\n  from: step-0\n`,
    );
  }
  return root;
}

Deno.test("[integrity] a fully-wired catalog passes with no violations", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, true, JSON.stringify(r.violations));
    assertEquals(r.violations.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] a flow referencing a non-existent agent role FAILS (dangling agent role)", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review"],
    flows: [{ id: "f", agentRoles: ["coder", "ghost"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.kind === "dangling-agent-role" && v.detail.includes("ghost")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] an agent role referencing a non-existent skill FAILS (dangling skill)", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review", "missing-skill"] }],
    skills: ["review"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.kind === "dangling-skill" && v.detail.includes("missing-skill")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] an agent role used by no flow FAILS (orphan agent role)", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }, { id: "lonely", skills: ["review"] }],
    skills: ["review"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.kind === "orphan-agent-role" && v.detail.includes("lonely")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] system agent roles (default, mock-model) are exempt from the orphan-agent-role rule", async () => {
  const root = await buildCatalog({
    agentRoles: [
      { id: "coder", skills: ["review"] },
      { id: "default", skills: ["review"] },
      { id: "mock-agent", model: "mock:test-model", skills: ["review"] },
    ],
    skills: ["review"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    // default + mock-agent are orphaned but exempt; coder is wired → no violations.
    assertEquals(r.ok, true, JSON.stringify(r.violations));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] dogfood-developer is exempt from the orphan-agent-role rule (invoked directly via --agent-role, not via a flow)", async () => {
  const root = await buildCatalog({
    agentRoles: [
      { id: "coder", skills: ["review"] },
      { id: "dogfood-developer", skills: ["review"] },
    ],
    skills: ["review"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, true, JSON.stringify(r.violations));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] a skill used by no agent role FAILS (orphan skill)", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review", "unused-skill"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.kind === "orphan-skill" && v.detail.includes("unused-skill")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] an explicitly programmatic skill is exempt from agent-role-default reachability", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review", "memory-extraction-content-policy"],
    flows: [{ id: "f", agentRoles: ["coder"] }],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, true, JSON.stringify(r.violations));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] a dangling agent role ref in a SUBDIRECTORY flow FAILS (recursive walk)", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review"],
    flows: [
      { id: "f", agentRoles: ["coder"] },
      { id: "nested", agentRoles: ["ghost"], subdir: "examples/dev" },
    ],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.kind === "dangling-agent-role" && v.detail.includes("ghost")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] a dangling agent role ref in a .flow.template.yaml FAILS", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review"],
    flows: [
      { id: "f", agentRoles: ["coder"] },
      { id: "pattern", agentRoles: ["ghost"], template: true, subdir: "templates" },
    ],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.kind === "dangling-agent-role" && v.detail.includes("ghost")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] {{placeholder}} agent slots in templates are skipped (not treated as agent roles)", async () => {
  const root = await buildCatalog({
    agentRoles: [{ id: "coder", skills: ["review"] }],
    skills: ["review"],
    flows: [
      { id: "f", agentRoles: ["coder"] },
      // A template whose agent slots are {{placeholder}} tokens — must NOT count
      // as dangling agent-role references.
      { id: "pipeline", agentRoles: ['"{{coordinator}}"', '"{{processor}}"'], template: true, subdir: "templates" },
    ],
  });
  try {
    const r = checkBlueprintIntegrity(root);
    assertEquals(r.ok, true, JSON.stringify(r.violations));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[integrity] the live repository catalog passes the gate", () => {
  // Run against the real Blueprints/ so the gate reflects committed state.
  const r = checkBlueprintIntegrity(join(import.meta.dirname!, "..", "..", "Blueprints"));
  assert(
    r.ok,
    `live catalog has integrity violations:\n${r.violations.map((v) => `  ${v.kind}: ${v.detail}`).join("\n")}`,
  );
});
