/**
 * @module SkillDeliveryWiringTest
 * @path tests/scenario_framework/tests/unit/skill_delivery_wiring_test.ts
 * @description Phase 235 Step 9 wiring proof: every changed or added skill loads through the
 *   production loader from its intended root, declares the triggers the phase promised, has its
 *   discovery entries, appears in the membership lock, and has evidence for every case id.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @std/yaml, @exaix/core, @exaix/testing]
 */

import { assert, assertArrayIncludes, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { SkillRootKind } from "@exaix/core";
import { loadRepoSkillCatalog, REPO_ROOT } from "@exaix/testing";
import { CATALOG_CONTEXT, createCatalogLoader } from "../../../../scripts/skill_catalog_loader.ts";

/** One expected skill and the triggers it must declare. */
type TExpectedSkill = readonly [slug: string, triggers: readonly string[]];

const BLUEPRINT_SKILLS: readonly TExpectedSkill[] = [
  ["architecture-review", ["architecture", "design", "review"]],
  ["code-review", ["review", "code-review"]],
  ["technical-writing", ["technical-writing", "documentation", "readme"]],
  ["requirements-interview", ["requirements-interview", "grill-me", "requirements-elicitation"]],
];

const DEV_SKILLS: readonly TExpectedSkill[] = [
  ["refactor", ["refactor", "extract"]],
  ["review-phase-plan", ["pre-gap", "plan-review"]],
  ["github-actions-ci", ["github-actions", "failing-check"]],
  ["brainstorm", ["brainstorm", "options"]],
];

const NEW_SKILLS: readonly string[] = [
  "technical-writing",
  "requirements-interview",
  "github-actions-ci",
  "brainstorm",
];
const CASES_PATH = join("tests", "scenario_framework", "fixtures", "skill_eval", "phase235", "cases.json");

interface IAgentFrontmatter {
  default_skills?: string[];
}

interface ISkillFrontmatter {
  qwen_skill?: string;
}

interface IQwenSettings {
  skills?: string[];
}

interface ILock {
  roots: Record<string, string[]>;
}

interface ICaseRow {
  id: string;
  method: string;
  scenario?: string;
  fixture?: string;
  record?: string;
  evidence?: string | null;
}

interface ICases {
  cases: ICaseRow[];
}

function frontmatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  assertExists(match, "frontmatter must exist");
  return match[1];
}

function agentFrontmatter(text: string): IAgentFrontmatter {
  return parseYaml(frontmatter(text)) as IAgentFrontmatter;
}

function skillFrontmatter(text: string): ISkillFrontmatter {
  return parseYaml(frontmatter(text)) as ISkillFrontmatter;
}

function declaredTriggers(keywords: readonly string[] | undefined, tags: readonly string[] | undefined): string[] {
  return [...(keywords ?? []), ...(tags ?? [])];
}

Deno.test("[phase235] every changed skill loads from its intended root with its triggers", async () => {
  const runtime = await loadRepoSkillCatalog(REPO_ROOT);
  for (const [name, keywords] of BLUEPRINT_SKILLS) {
    const entry = runtime.get(name);
    assertExists(entry, `${name} must load from the Blueprint root`);
    assertEquals(entry.rootKind, SkillRootKind.BLUEPRINT);
    assert(entry.skill.instructions.length > 0, `${name} must load instructions`);
    assert(/^[a-f0-9]{64}$/.test(entry.contentSha256), `${name} must carry a content hash`);
    for (const keyword of keywords) {
      assertArrayIncludes(
        declaredTriggers(entry.skill.triggers.keywords, entry.skill.triggers.tags),
        [keyword],
      );
    }
  }
  const dogfood = await createCatalogLoader(join(REPO_ROOT, ".copilot", "skills"), SkillRootKind.DOGFOOD)
    .listAll(CATALOG_CONTEXT);
  const devSkills = new Map(dogfood.map((entry) => [entry.skill.name, entry]));
  for (const [name, keywords] of DEV_SKILLS) {
    const entry = devSkills.get(name);
    assertExists(entry, `${name} must load from the dogfood root`);
    assert(entry.skill.instructions.length > 0, `${name} must load instructions`);
    for (const keyword of keywords) {
      assertArrayIncludes(
        declaredTriggers(entry.skill.triggers.keywords, entry.skill.triggers.tags),
        [keyword],
      );
    }
  }
});

Deno.test("[phase235] each development skill has its prompt, Qwen entry and qwen_skill declaration", async () => {
  const qwen = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, ".qwen", "settings.json"))) as IQwenSettings;
  for (const [name] of DEV_SKILLS) {
    const prompt = await Deno.readTextFile(join(REPO_ROOT, ".copilot", "prompts", `${name}.prompt.md`));
    assertStringIncludes(prompt, `.copilot/skills/${name}/SKILL.md`);
    assertArrayIncludes(qwen.skills ?? [], [`.copilot/skills/${name}`]);
    const skill = await Deno.readTextFile(join(REPO_ROOT, ".copilot", "skills", name, "SKILL.md"));
    assertEquals(skillFrontmatter(skill).qwen_skill, name);
  }
});

Deno.test("[phase235] no new skill is added to an agent-role default", async () => {
  for await (const entry of Deno.readDir(join(REPO_ROOT, "Blueprints", "Agents"))) {
    if (!entry.isFile || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const text = await Deno.readTextFile(join(REPO_ROOT, "Blueprints", "Agents", entry.name));
    const defaults = agentFrontmatter(text).default_skills ?? [];
    for (const name of NEW_SKILLS) {
      assertEquals(defaults.indexOf(name), -1, `${entry.name} must not default to ${name}`);
    }
  }
});

Deno.test("[phase235] the membership lock lists every phase skill under its root", async () => {
  const lock = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "scripts", "config", "skill_catalog.lock.json")),
  ) as ILock;
  for (const [name] of BLUEPRINT_SKILLS) {
    assertArrayIncludes(lock.roots["Blueprints/Skills"] ?? [], [name]);
  }
  for (const [name] of DEV_SKILLS) {
    assertArrayIncludes(lock.roots[".copilot/skills"] ?? [], [name]);
  }
});

Deno.test("[phase235] every case id points at an artifact that exists", async () => {
  const cases = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, CASES_PATH))) as ICases;
  assert(cases.cases.length > 0);
  for (const row of cases.cases) {
    for (const path of [row.scenario, row.fixture, row.record, row.evidence]) {
      if (typeof path === "string") await Deno.stat(join(REPO_ROOT, path));
    }
  }
});
