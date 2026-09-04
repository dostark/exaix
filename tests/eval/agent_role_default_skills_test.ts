/**
 * @module AgentRoleDefaultSkillsTest
 * @path tests/eval/agent_role_default_skills_test.ts
 * @description Phase 142 Step 17 — guards the agent role `default_skills` lists.
 *
 *   Under the always-concatenate model every default is injected on every request that
 *   agent role handles, unconditionally. That makes list LENGTH the budget control (the
 *   critical-only union that used to trim them is gone), so these lists must stay short and
 *   every entry must resolve — a dangling id is a silently-missing skill, and an over-long
 *   list is prompt weight paid on every request for no return.
 * @architectural-layer Test
 * @dependencies [Blueprints/Agents/, Memory/Skills/]
 * @related-files [packages/execution/src/agent_runner.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { readRuntimeSkillIds } from "./runtime_skill_scopes.ts";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const AGENTS_DIR = join(REPO_ROOT, "Blueprints", "Agents");
const MEMORY_SKILLS = join(REPO_ROOT, "Memory", "Skills");

// Upper bound on an agent role's `default_skills`. Matches `DEFAULT_CONFIG.maxSkillsPerRequest`
// in `packages/core/src/skills/skills.ts`: that cap governs dynamically matched skills, and
// defaults should not exceed on their own what matching is allowed to contribute in total.
const MAX_DEFAULT_SKILLS = 5;

// Skills that reach a prompt through trigger matching rather than `default_skills`. Mirrors
// `scripts/check_blueprint_integrity.ts:TRIGGER_MATCHED_SKILLS`. Each declares triggers (keywords,
// tags, task types), so listing it as a default charges every request for a skill the matcher would only supply when needed.
const TRIGGER_MATCHED_SKILL_IDS: ReadonlySet<string> = new Set([
  "fix-bug",
  "portal-grounding",
  "commit-message",
  "gap-analysis",
  "code-review",
  "error-handling",
]);

interface IAgentRoleFrontmatter {
  default_skills?: string[];
}

interface IAgentRoleDefaults {
  agentRole: string;
  defaults: string[];
}

// Every runtime skill id, across every scope. Delegates to the shared scope declaration: this
// test and `skill_seed_runtime_integrity_test.ts` previously disagreed about where the runtime
// catalog lives, and the disagreement is what produced two exclusions for skills that were present.
function readCatalogSkillIds(): Promise<Set<string>> {
  return readRuntimeSkillIds(MEMORY_SKILLS);
}

async function readAgentRoleDefaults(): Promise<IAgentRoleDefaults[]> {
  const rows: IAgentRoleDefaults[] = [];
  for await (const entry of Deno.readDir(AGENTS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const text = await Deno.readTextFile(join(AGENTS_DIR, entry.name));
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = match ? parseYaml(match[1]) as IAgentRoleFrontmatter : {};
    rows.push({
      agentRole: entry.name.replace(/\.md$/, ""),
      defaults: frontmatter.default_skills ?? [],
    });
  }
  rows.sort((a, b) => a.agentRole.localeCompare(b.agentRole));
  return rows;
}

Deno.test("agent_role_default_skills — every declared default resolves in the runtime catalog", async () => {
  const catalog = await readCatalogSkillIds();
  const dangling: string[] = [];
  for (const agentRole of await readAgentRoleDefaults()) {
    for (const skillId of agentRole.defaults) {
      if (!catalog.has(skillId)) dangling.push(`${agentRole.agentRole} -> ${skillId}`);
    }
  }
  assertEquals(dangling.sort(), [], `default_skills entries with no catalog skill:\n${dangling.join("\n")}`);
});

Deno.test("agent_role_default_skills — no agent role exceeds the default-skills budget", async () => {
  const overCap = (await readAgentRoleDefaults())
    .filter((agentRole) => agentRole.defaults.length > MAX_DEFAULT_SKILLS)
    .map((agentRole) => `${agentRole.agentRole} (${agentRole.defaults.length})`);
  assertEquals(
    overCap,
    [],
    `agent roles exceeding ${MAX_DEFAULT_SKILLS} default skills — every entry is unconditional ` +
      `prompt weight on every request:\n${overCap.join("\n")}`,
  );
});

Deno.test("agent_role_default_skills — no agent role carries both the generic and a specialised response contract", async () => {
  const doubled: string[] = [];
  for (const agentRole of await readAgentRoleDefaults()) {
    const contracts = agentRole.defaults.filter((id) => id.startsWith("response-contract"));
    if (contracts.includes("response-contract") && contracts.length > 1) {
      doubled.push(`${agentRole.agentRole}: ${contracts.join(" + ")}`);
    }
  }
  assertEquals(
    doubled.sort(),
    [],
    `agent roles paying for two overlapping output contracts on every request:\n${doubled.join("\n")}`,
  );
});

Deno.test("agent_role_default_skills — the README's authoring example obeys the rules a real agent role must", async () => {
  // The README is where a contributor learns the shape, so a stale example reintroduces exactly
  // what a prior pruning removed. Its previous example carried `portal-grounding`, removed from all
  // agent roles because the skill declares triggers and is picked up dynamically — the cap test couldn't have caught it.
  const readme = await Deno.readTextFile(join(AGENTS_DIR, "README.md"));
  const catalog = await readCatalogSkillIds();

  const examples = [...readme.matchAll(/default_skills:\s*\[([^\]]*)\]/g)]
    .map((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]))
    .filter((entries) => entries.length > 0);

  assert(examples.length > 0, "the README must show at least one default_skills example");

  const problems: string[] = [];
  for (const [index, entries] of examples.entries()) {
    for (const skillId of entries) {
      if (!catalog.has(skillId)) problems.push(`example ${index + 1}: "${skillId}" is not a catalog skill`);
      if (TRIGGER_MATCHED_SKILL_IDS.has(skillId)) {
        problems.push(
          `example ${index + 1}: "${skillId}" declares triggers, so it belongs in the trigger ` +
            "channel rather than in default_skills",
        );
      }
    }
    if (entries.length > MAX_DEFAULT_SKILLS) {
      problems.push(`example ${index + 1}: ${entries.length} entries exceeds the cap of ${MAX_DEFAULT_SKILLS}`);
    }
    const contracts = entries.filter((id) => id.startsWith("response-contract"));
    if (contracts.includes("response-contract") && contracts.length > 1) {
      problems.push(`example ${index + 1}: carries two overlapping output contracts`);
    }
  }

  assertEquals(
    problems.sort(),
    [],
    `the agent role authoring README teaches a shape the catalog rejects:\n  ${problems.join("\n  ")}`,
  );
});
