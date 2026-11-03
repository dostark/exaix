/**
 * @module ConsumerDocsTest
 * @path packages/lint-policy/tests/consumer_docs_test.ts
 * @description Proves that the Exaix enforcement guide and the generated reference describe the sixteen activated rules, their scopes and the error-input contract.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @exaix/testing]
 * @related-files [packages/lint-policy/docs/style_guide.md, packages/lint-policy/docs/style_rules.md, packages/lint-policy/tests/style_guide_claims_test.ts]
 */

import { assert, assertArrayIncludes, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { POLICY_CATALOG } from "../src/policy_config.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const POLICY_GUIDE = "packages/lint-policy/docs/style_guide.md";
const GENERATED_REFERENCE = "packages/lint-policy/docs/style_rules.md";
const ENFORCEMENT_HEADING = "## Enforcement Status";
const ERROR_INPUT_HEADING = "## Error Inputs {#error-inputs}";
const DEFAULT_SCOPE = "all";
const SCOPED_LABELS: Readonly<Record<string, string>> = {
  test: "Test-scoped plugin gates",
  prod: "Production-scoped plugin gates",
};
const GENERATOR = "scripts/generate_style_rules_doc.ts";
const ROOT_CONFIG = "deno.json";
const BACKTICKED_ID = /`(exaix\/[a-z][a-z0-9-]*)`/g;

const SIXTEEN_RULES = [
  "exaix/import-placement",
  "exaix/re-export-imported",
  "exaix/exported-interface-placement",
  "exaix/no-interface-rename-on-import",
  "exaix/long-comment",
  "exaix/ephemeral-comment",
  "exaix/test-inline-multiline-fixture",
  "exaix/no-constant-substring-assert",
  "exaix/promise-response-return",
  "exaix/magic-union-type",
  "exaix/no-object-parameters",
  "exaix/no-unsafe-dictionary",
  "exaix/no-typeof-escape",
  "exaix/no-explicit-unknown",
  "exaix/no-repeated-assert-call",
  "exaix/no-boolean-assert",
];

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(join(REPO_ROOT, path));
}

/** The section of the guide from the heading to the next second-level heading. */
function sectionOf(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert(start >= 0, `the guide has no ${heading} section`);
  const rest = text.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The ids named by the Enforcement Status bullet that starts with the label. */
function idsOfBullet(section: string, label: string): string[] {
  const bullet = section.split(/\n(?=- )/).find((candidate) => candidate.startsWith(`- **${label}`));
  assert(bullet !== undefined, `the Enforcement Status has no ${label} bullet`);
  return [...bullet.split("\n\n")[0].matchAll(BACKTICKED_ID)].map((match) => match[1]).sort();
}

function scopeOf(id: string): string {
  return POLICY_CATALOG.rules[id].scope ?? DEFAULT_SCOPE;
}

Deno.test("consumer-doc-state: the generated reference lists each activated rule with its catalog status and scope", async () => {
  const reference = await read(GENERATED_REFERENCE);
  for (const id of SIXTEEN_RULES) {
    const rule = POLICY_CATALOG.rules[id];
    assertEquals(rule.severity, "error", id);
    const row = reference.split("\n").find((line) => line.startsWith(`| \`${id}\``));
    assert(row !== undefined, `${id} has no row in the generated reference`);
    const cells = row.split("|").map((cell) => cell.trim());
    assertEquals(cells[2], "plugin", id);
    assertEquals(cells[3], "error", id);
    assertEquals(cells[4], scopeOf(id), id);
  }
});

Deno.test("consumer-doc-state: the guide names the plugin gates and the scoped subsets of the sixteen rules", async () => {
  const guide = await read(POLICY_GUIDE);
  const section = guide.slice(guide.indexOf(ENFORCEMENT_HEADING));
  const gates = idsOfBullet(section, "Plugin gates");
  const parked = idsOfBullet(section, "Parked plugin rules");
  for (const id of SIXTEEN_RULES) {
    assertArrayIncludes(gates, [id], `${id} is not listed as a plugin gate`);
    assert(!parked.includes(id), `${id} is still listed as parked`);
  }
  for (const [scope, label] of Object.entries(SCOPED_LABELS)) {
    const expected = SIXTEEN_RULES.filter((id) => scopeOf(id) === scope).sort();
    assert(expected.length > 0, `no activated rule has the ${scope} scope`);
    assertEquals(idsOfBullet(section, label), expected, label);
  }
});

Deno.test("consumer-doc-state: the guide calls the v1 fixture a maintained compatibility baseline", async () => {
  const section = sectionOf(await read(POLICY_GUIDE), ENFORCEMENT_HEADING);
  assertStringIncludes(section, "maintained compatibility baseline");
  assertStringIncludes(section, "catalog_v1.json");
  assert(!section.includes("historical version 1 snapshot"), "the stale wording remains");
});

Deno.test("consumer-doc-state: the error input section matches the exported handler and step result owners", async () => {
  const section = sectionOf(await read(POLICY_GUIDE), ERROR_INPUT_HEADING);
  for (const phrase of ["IRejectedPlanHandler.handleError<TError>", "@exaix/request", "IStepResult", "@exaix/flow"]) {
    assertStringIncludes(section, phrase);
  }
  assertStringIncludes(await read("packages/request/src/rejected_plan_handler.ts"), "handleError<TError>(");
  assertStringIncludes(await read("packages/request/src/mod.ts"), "type IRejectedPlanHandler");
  assertStringIncludes(await read("packages/flow/src/flow_runner.ts"), "export interface IStepResult");
  assertStringIncludes(await read("packages/flow/mod.ts"), "export type { IStepResult }");
});

/** The reference text without table padding, dash runs or blank lines, so the formatter's layout does not matter. */
function withoutAlignment(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/-{3,}/g, "---").split("\n").filter((line) => line.trim() !== "").join(
    "\n",
  );
}

/** Runs the generator with the given directory as its working directory and returns the reference it wrote. */
async function generateIn(dir: string): Promise<string> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      `--config=${join(REPO_ROOT, ROOT_CONFIG)}`,
      "--allow-read",
      "--allow-write",
      "--allow-env",
      join(REPO_ROOT, GENERATOR),
    ],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return await Deno.readTextFile(join(dir, GENERATED_REFERENCE));
}

Deno.test("consumer-doc-idempotence: two generator runs agree and match the committed reference", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, GENERATED_REFERENCE);
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.copyFile(join(REPO_ROOT, GENERATED_REFERENCE), target);
    const first = await generateIn(dir);
    const second = await generateIn(dir);
    assertEquals(second, first);
    assertEquals(withoutAlignment(first), withoutAlignment(await read(GENERATED_REFERENCE)));
  });
});
