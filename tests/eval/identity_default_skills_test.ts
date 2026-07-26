/**
 * @module IdentityDefaultSkillsTest
 * @path tests/eval/identity_default_skills_test.ts
 * @description Phase 142 Step 17 — guards the identity `default_skills` lists.
 *
 *   Under the always-concatenate model every default is injected on every request that
 *   identity handles, unconditionally. That makes list LENGTH the budget control (the
 *   critical-only union that used to trim them is gone), so these lists must stay short and
 *   every entry must resolve — a dangling id is a silently-missing skill, and an over-long
 *   list is prompt weight paid on every request for no return.
 * @architectural-layer Test
 * @dependencies [Blueprints/Identities/, Memory/Skills/]
 * @related-files [packages/execution/src/agent_runner.ts]
 */
import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Identities");
const RUNTIME_SCOPES = ["global", "core", "learned", join("project", "Exaix")];

/**
 * Upper bound on an identity's `default_skills`.
 *
 * Matches `DEFAULT_CONFIG.maxSkillsPerRequest` in `packages/core/src/skills/skills.ts`: that
 * cap governs dynamically matched skills, and defaults should not be able to exceed on their
 * own what matching is allowed to contribute in total.
 */
const MAX_DEFAULT_SKILLS = 5;

interface IIdentityFrontmatter {
  default_skills?: string[];
}

interface IIdentityDefaults {
  identityId: string;
  defaults: string[];
}

async function readCatalogSkillIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const scope of RUNTIME_SCOPES) {
    try {
      for await (const entry of Deno.readDir(join(REPO_ROOT, "Memory", "Skills", scope))) {
        if (entry.isFile && entry.name.endsWith(".json")) ids.add(entry.name.replace(/\.json$/, ""));
      }
    } catch { /* scope dir absent */ }
  }
  return ids;
}

async function readIdentityDefaults(): Promise<IIdentityDefaults[]> {
  const rows: IIdentityDefaults[] = [];
  for await (const entry of Deno.readDir(IDENTITIES_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const text = await Deno.readTextFile(join(IDENTITIES_DIR, entry.name));
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = match ? parseYaml(match[1]) as IIdentityFrontmatter : {};
    rows.push({
      identityId: entry.name.replace(/\.md$/, ""),
      defaults: frontmatter.default_skills ?? [],
    });
  }
  rows.sort((a, b) => a.identityId.localeCompare(b.identityId));
  return rows;
}

Deno.test("identity_default_skills — every declared default resolves in the runtime catalog", async () => {
  const catalog = await readCatalogSkillIds();
  const dangling: string[] = [];
  for (const identity of await readIdentityDefaults()) {
    for (const skillId of identity.defaults) {
      if (!catalog.has(skillId)) dangling.push(`${identity.identityId} -> ${skillId}`);
    }
  }
  assertEquals(dangling.sort(), [], `default_skills entries with no catalog skill:\n${dangling.join("\n")}`);
});

Deno.test("identity_default_skills — no identity exceeds the default-skills budget", async () => {
  const overCap = (await readIdentityDefaults())
    .filter((identity) => identity.defaults.length > MAX_DEFAULT_SKILLS)
    .map((identity) => `${identity.identityId} (${identity.defaults.length})`);
  assertEquals(
    overCap,
    [],
    `identities exceeding ${MAX_DEFAULT_SKILLS} default skills — every entry is unconditional ` +
      `prompt weight on every request:\n${overCap.join("\n")}`,
  );
});

Deno.test("identity_default_skills — no identity carries both the generic and a specialised response contract", async () => {
  const doubled: string[] = [];
  for (const identity of await readIdentityDefaults()) {
    const contracts = identity.defaults.filter((id) => id.startsWith("response-contract"));
    if (contracts.includes("response-contract") && contracts.length > 1) {
      doubled.push(`${identity.identityId}: ${contracts.join(" + ")}`);
    }
  }
  assertEquals(
    doubled.sort(),
    [],
    `identities paying for two overlapping output contracts on every request:\n${doubled.join("\n")}`,
  );
});
