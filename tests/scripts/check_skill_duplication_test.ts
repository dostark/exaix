/**
 * @module SkillDuplicationCheckTest
 * @path tests/scripts/check_skill_duplication_test.ts
 * @description Phase 195 — RED-first tests for the shared authoring gate that rejects
 *   duplicated instruction prose spread across the skill corpora (Blueprints and .copilot).
 *   A repeated canonical block in N skills loads as N copies of the same text in one prompt
 *   (EXAIX-04: no needless repetition) and inflates every request's loaded context. The
 *   checker extracts frontmatter-stripped, fence-removed body prose, normalizes it, and
 *   reports any normalized sentence present in two or more distinct skill files — unless a
 *   reviewed allowlist entry documents why that exact text is intentionally shared. Tests
 *   cover the real CLI entry point (exit 0/1/2), fixture-level duplicate detection, the
 *   allowlist path, a clean real-corpus run after the step-4 deduplication, policy-schema
 *   validation, and per-fixture policies so allowlist fixtures never touch the real config.
 * @architectural-layer Test
 * @related-files [
 *   "scripts/check_skill_duplication.ts"
 * ]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  discoverSkillFiles,
  extractProseLines,
  loadDuplicationPolicy,
  normalizeProseLine,
  runSkillDuplicationCheck,
} from "../../scripts/check_skill_duplication.ts";

const CHECKER_SCRIPT = join(import.meta.dirname!, "../../scripts/check_skill_duplication.ts");
const FIXTURES_DIR = join(import.meta.dirname!, "fixtures/skill_duplication");
const REAL_POLICY = join(import.meta.dirname!, "../../scripts/config/skill_duplication_policy.json");
const REPO_ROOT = resolve(import.meta.dirname!, "../..");

function fixturePolicy(caseName: string): string {
  return join(FIXTURES_DIR, caseName, "policy.json");
}

/** Runs the real CLI entry point as a subprocess and returns { code, output }. */
async function runCli(args: string[]): Promise<{ code: number; output: string }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-read", CHECKER_SCRIPT, ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const proc = await cmd.output();
  return {
    code: proc.code,
    output: new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr),
  };
}

Deno.test("Skill duplication: normalized prose lines extracted from a skill body", () => {
  const lines = extractProseLines(
    "# Title\n\nInstruction line one.\n```json\n{unrelated}\n```\n--\nsecond instruction",
  );
  const joined = lines.map((l) => l.toLowerCase()).join("|");
  assertStringIncludes(joined, "instruction line one");
  assertStringIncludes(joined, "second instruction");
  assertEquals(lines.some((l) => l.includes("unrelated")), false, "fenced content is excluded");
  assertEquals(
    normalizeProseLine("  Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose. "),
    "use asd ste100 and exaix ste extension v1 for instruction and response prose",
  );
});

Deno.test("Skill duplication: real CLI flags a duplicated prose sentence across two skills", async () => {
  const { code, output } = await runCli([
    "--skills-dir",
    join(FIXTURES_DIR, "duplicate"),
    "--policy",
    fixturePolicy("duplicate"),
  ]);
  assertEquals(code, 1, output);
  assertStringIncludes(output, "request exceeds the context budget");
  assertStringIncludes(output, "exit 1");
});

Deno.test("Skill duplication: a clean corpus with no cross-file repetition passes", async () => {
  const { code, output } = await runCli([
    "--skills-dir",
    join(FIXTURES_DIR, "clean"),
    "--policy",
    fixturePolicy("clean"),
  ]);
  assertEquals(code, 0, output);
});

Deno.test("Skill duplication: allowlisted text is exempt with a documented reason", async () => {
  const { code, output } = await runCli([
    "--skills-dir",
    join(FIXTURES_DIR, "allowlisted"),
    "--policy",
    fixturePolicy("allowlisted"),
  ]);
  assertEquals(code, 0, output);
});

Deno.test("Skill duplication: a missing or malformed policy exits 2", async () => {
  const { code, output } = await runCli([
    "--skills-dir",
    join(FIXTURES_DIR, "clean"),
    "--policy",
    join(FIXTURES_DIR, "clean", "missing-policy.json"),
  ]);
  assertEquals(code, 2, output);
});

Deno.test("Skill duplication: real Blueprint + .copilot corpora pass after step-4 deduplication", async () => {
  const { code, output } = await runCli(["--repo-root", REPO_ROOT, "--policy", REAL_POLICY]);
  assertEquals(code, 0, output);
});

Deno.test("Skill duplication: policy schema is current and every entry documents a reason", () => {
  const policy = loadDuplicationPolicy(REAL_POLICY);
  assertEquals(policy.version, "1");
  for (const entry of policy.allowlist) {
    assertEquals(entry.reason.length > 0, true, `allowlist entry ${entry.text} needs a reason`);
    assertEquals(entry.text.length > 0, true);
  }
});

Deno.test("Skill duplication: discovery walks both corpora and returns repo-relative paths", () => {
  const files = discoverSkillFiles(REPO_ROOT);
  assertStringIncludes(files.join("\n"), "Blueprints/Skills/response-contract.skill.md");
  assertStringIncludes(files.join("\n"), ".copilot/skills/commit/SKILL.md");
});

Deno.test("Skill duplication: programmatic check returns findings with file locations", () => {
  const findings = runSkillDuplicationCheck({
    skillsDir: join(FIXTURES_DIR, "duplicate"),
    policyPath: fixturePolicy("duplicate"),
  });
  assertEquals(findings.some((f) => f.text.includes("request exceeds the context budget")), true);
  for (const finding of findings) {
    assertEquals(finding.files.length >= 2, true, "finding must span two or more files");
    assertEquals(finding.files[0].endsWith(".skill.md"), true);
  }
});
