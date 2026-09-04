/**
 * @module CriticalSkillCoverageTest
 * @path tests/eval/critical_skill_coverage_test.ts
 * @description Phase 142 Step 17 — asserts every output-contract skill carries
 *   `critical: true` in BOTH its seed (`Blueprints/Skills/*.skill.md`) and its runtime
 *   counterpart (`Memory/Skills/**\/*.json`).
 *
 *   `critical` is the compaction guarantee: `renderCriticalSkillsSection` emits a
 *   `REQUIRED SKILLS & CONTRACT` block that AgentRunner inserts with
 *   `nonCompactable: true`, so flagged skills survive context-budget pressure. Only 2 of 27
 *   skills carried the flag, which meant an agent role holding just a specialised contract
 *   variant — the four analysis agent roles, quality-judge, voting-judge — had NO
 *   compaction-protected contract at all: exactly the failure the flag exists to prevent,
 *   on the agent roles whose output format matters most.
 * @architectural-layer Test
 * @dependencies [packages/core/src/func/prompt_formatter.ts]
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/func/prompt_formatter.ts]
 */
import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SEEDS_DIR = join(REPO_ROOT, "Blueprints", "Skills");
const RUNTIME_DIRS = ["global", "core", "learned", join("project", "Exaix")];

// Skills whose content must survive compaction: `response-contract*` defines the mandatory
// response format and per-domain `<content>` templates (dropping one leaves no output contract);
// `verdict-rubric` carries scoring criteria whose loss is a silent correctness loss, not a visible break.
function mustBeCritical(skillId: string): boolean {
  return skillId.startsWith("response-contract") ||
    skillId === "verdict-rubric" ||
    skillId === "memory-extraction-content-policy";
}

/** The seed frontmatter fields this test reads. */
interface ISeedFrontmatter {
  skill_id?: string;
  critical?: boolean;
}

interface ISkillRecord {
  skillId: string;
  critical: boolean;
  source: string;
}

async function readRuntimeSkills(): Promise<ISkillRecord[]> {
  const records: ISkillRecord[] = [];
  for (const scope of RUNTIME_DIRS) {
    const dir = join(REPO_ROOT, "Memory", "Skills", scope);
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        const parsed = JSON.parse(await Deno.readTextFile(join(dir, entry.name)));
        records.push({
          skillId: parsed.skill_id ?? entry.name.replace(/\.json$/, ""),
          critical: parsed.critical === true,
          source: `Memory/Skills/${scope}/${entry.name}`,
        });
      }
    } catch { /* scope dir absent — nothing to check */ }
  }
  return records;
}

async function readSeedSkills(): Promise<ISkillRecord[]> {
  const records: ISkillRecord[] = [];
  for await (const entry of Deno.readDir(SEEDS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".skill.md")) continue;
    const text = await Deno.readTextFile(join(SEEDS_DIR, entry.name));
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = match ? parseYaml(match[1]) as ISeedFrontmatter : {};
    records.push({
      skillId: String(frontmatter.skill_id ?? entry.name.replace(/\.skill\.md$/, "")),
      critical: frontmatter.critical === true,
      source: `Blueprints/Skills/${entry.name}`,
    });
  }
  return records;
}

Deno.test("critical_skill_coverage — every output-contract runtime skill is critical", async () => {
  const unflagged = (await readRuntimeSkills())
    .filter((s) => mustBeCritical(s.skillId) && !s.critical)
    .map((s) => s.source);
  assertEquals(
    unflagged.sort(),
    [],
    `output-contract skills missing \`critical: true\` — they would be dropped under context pressure:\n${
      unflagged.join("\n")
    }`,
  );
});

Deno.test("critical_skill_coverage — seed and runtime agree on the critical flag", async () => {
  const runtime = new Map((await readRuntimeSkills()).map((s) => [s.skillId, s.critical]));
  const drift: string[] = [];
  for (const seed of await readSeedSkills()) {
    if (!runtime.has(seed.skillId)) continue; // seed↔runtime parity is its own test
    if (runtime.get(seed.skillId) !== seed.critical) {
      drift.push(`${seed.skillId}: seed=${seed.critical} runtime=${runtime.get(seed.skillId)}`);
    }
  }
  assertEquals(drift.sort(), [], `critical flag differs between seed and runtime:\n${drift.join("\n")}`);
});

Deno.test("critical_skill_coverage — the flag stays deliberate, not universal", async () => {
  // A flag set on everything protects nothing: the non-compactable segment would hold the
  // entire catalog and defeat the budget it exists to work within.
  const runtime = await readRuntimeSkills();
  const critical = runtime.filter((s) => s.critical);
  assertEquals(
    critical.every((s) => mustBeCritical(s.skillId)),
    true,
    `skills flagged critical outside the output-contract family: ${
      critical.filter((s) => !mustBeCritical(s.skillId)).map((s) => s.skillId).join(", ")
    }`,
  );
});
