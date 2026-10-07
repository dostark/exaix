/**
 * @module SkillFoldersDocsTest
 * @path tests/docs/skill_folders_docs_test.ts
 * @description Active guidance matches the skill folder behavior. The registered `exactl skills` commands and their
 *   options appear in the User Guide, the sample config skills tables parse through the real config schema, the
 *   journal tables and skill events appear in the reference data, and active guidance never tells a reader to use
 *   the removed compiler, the runtime JSON store or flat skill files. Historical records are excluded.
 * @architectural-layer Test
 * @related-files [tests/docs/helpers.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { DomainEventType } from "@exaix/core/events";
import { REPO_ROOT } from "@exaix/testing";

const GUIDE = "docs/Exaix_User_Guide.md";
const REFERENCE = "docs/Reference_Data.md";
const SAMPLE_CONFIG = "templates/exa.config.sample.toml";
const ACTIVE_GUIDANCE = [
  GUIDE,
  REFERENCE,
  "ARCHITECTURE.md",
  "CODE_STYLE.md",
  ".copilot/README.md",
  "Blueprints/Skills/README.md",
  "packages/execution/README.md",
  "packages/memory/README.md",
];
const REMOVED_LAYOUT_PATTERNS: readonly RegExp[] = [
  /generate_skill_json/,
  /build_skills_index/,
  /skill_envelope/i,
  /check:skill-envelopes/,
  /Memory\/Skills\/global/,
  /Memory\/Skills\/index\.json/,
  /<name>\.skill\.md/,
];
const SKILL_COMMANDS = [
  "list",
  "show",
  "match",
  "derive",
  "create",
  "approve",
  "deprecate",
  "revisions",
  "usage",
  "validate",
];
const EXACTL = join(REPO_ROOT, "apps", "exactl", "src", "exactl.ts");

const read = (path: string) => Deno.readTextFile(join(REPO_ROOT, path));

async function help(...args: string[]): Promise<string> {
  const output = await new Deno.Command("deno", {
    args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), EXACTL, ...args, "--help"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return stripAnsiCode(new TextDecoder().decode(output.stdout));
}

Deno.test("[skill docs] the User Guide documents every registered skills command and its public options", async () => {
  const guide = await read(GUIDE);
  const group = await help("skills");
  for (const command of SKILL_COMMANDS) {
    assert(new RegExp(`^\\s+${command}\\b`, "m").test(group), `exactl skills registers ${command}`);
    assert(guide.includes(`exactl skills ${command}`), `the Guide documents exactl skills ${command}`);
  }
  assert(guide.includes("exactl memory skill"), "the Guide documents the memory skill alias");
  for (const option of ["--revision", "--trace", "--portal", "--all"]) {
    assert(
      (await help("skills", option === "--trace" ? "usage" : option === "--all" ? "list" : "show")).includes(option),
    );
    assert(guide.includes(option), `the Guide documents ${option}`);
  }
  for (const phrase of ["exit code 2", "exit code 1", "draft", "global"]) {
    assert(guide.toLowerCase().includes(phrase), `the Guide explains "${phrase}"`);
  }
});

Deno.test("[skill docs] the sample config skills tables parse through the real config schema", async () => {
  const sample = await read(SAMPLE_CONFIG);
  const table = /\[skills\][\s\S]*?(?=\n\[[a-z_.]+\]|\n*$)/.exec(sample)?.[0];
  assert(table, "the sample config has a skills table");
  const parsed = parseToml(`${table}\n`) as { skills: { roots?: Array<{ kind: string; path: string }> } };
  const config = ConfigSchema.parse({ system: { root: "/tmp/skills-docs" }, skills: parsed.skills });
  assertEquals(config.skills.reference_max_count, 16);
  assert((config.skills.roots ?? []).length > 0, "the sample names explicit roots");
  assertEquals(ConfigSchema.parse({ system: { root: "/tmp/skills-docs" } }).skills.fallback_max_keywords, 32);
  assertEquals(
    ConfigSchema.parse({ system: { root: "/tmp/skills-docs" }, skills: { match_threshold: 0.5 } }).skills
      .main_max_bytes,
    262144,
    "a partial skills table keeps every other default",
  );
});

Deno.test("[skill docs] the reference data names the journal tables, columns and every skill event", async () => {
  const reference = await read(REFERENCE);
  for (const table of ["skill_revisions", "skill_usage"]) assert(reference.includes(table), `${table} is documented`);
  for (const column of ["revision_id", "content_sha256", "call_id", "match_source", "render_mode", "submission_kind"]) {
    assert(reference.includes(column), `the column ${column} is documented`);
  }
  const skillEvents = Object.values(DomainEventType).filter((value) => /^skills?\./.test(value));
  assert(skillEvents.length >= 15, "the registry holds the skill events");
  for (const event of skillEvents) assert(reference.includes(`\`${event}\``), `${event} is documented`);
  assert(reference.includes("resolved_skills"), "the plan pin field is documented");
});

Deno.test("[skill docs] active guidance never instructs the removed compiler, runtime JSON store or flat files", async () => {
  for (const path of ACTIVE_GUIDANCE) {
    const text = await read(path);
    for (const pattern of REMOVED_LAYOUT_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split("\n").length;
        throw new Error(`${path}:${line} still names the removed layout (${pattern})`);
      }
    }
  }
});

Deno.test("[skill docs] the reference data documents the scope table and the append-only retention rule", async () => {
  const reference = await read(REFERENCE);
  assert(reference.includes("skill_revision_scopes"), "the scope table is documented");
  assert(/append-only/i.test(reference), "the retention rule is documented");
  const guide = await read(GUIDE);
  assert(guide.includes("own portal"), "the Guide explains the portal rule for history reads");
  assert(/control (byte|character)s?/i.test(guide), "the Guide explains that control bytes are removed from output");
});
