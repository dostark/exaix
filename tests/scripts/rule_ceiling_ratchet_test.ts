/**
 * @module RuleCeilingRatchetTest
 * @path tests/scripts/rule_ceiling_ratchet_test.ts
 * @description Behaviour of the rule-ceiling ratchet evaluator.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/tests/check_code_style_catalog_parity_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { evaluateCeilings } from "../../unslop-ts/src/cli/rule_ceiling.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const RATCHETED_RULES = [
  "exaix/require-safety-comment",
  "exaix/no-runtime-typeof",
  "exaix/no-conditional-empty-object-spread",
  "exaix/no-explicit-unknown",
  "exaix/no-typeof-escape",
  "exaix/no-unsafe-dictionary",
  "exaix/no-object-parameters",
  "exaix/no-boolean-assert",
  "exaix/no-repeated-assert-call",
  "exaix/no-constant-substring-assert",
];

const KNOWN_RULES = ["exaix/require-safety-comment", "exaix/no-runtime-typeof"];
const KNOWN_PACKAGES = ["packages/flow", "packages/core"];

Deno.test("a count above the ceiling is reported with its delta", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/flow": 3 } },
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.over.length, 1);
  assertEquals(result.over[0].delta, 2);
  assertEquals(result.under.length, 0);
});

Deno.test("a count below the ceiling must be written back", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    { "exaix/no-runtime-typeof": { "packages/flow": 3 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.under.length, 1);
  assertEquals(result.under[0].count, 3);
  assertEquals(result.over.length, 0);
});

Deno.test("a count equal to the ceiling is clean", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.over, []);
  assertEquals(result.under, []);
});

Deno.test("an unknown rule id is rejected", () => {
  const result = evaluateCeilings(
    { "exaix/not-a-rule": { "packages/flow": 1 } },
    {},
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.unknownRules, ["exaix/not-a-rule"]);
});

Deno.test("an unknown package key is rejected", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/ghost": 1 } },
    {},
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.unknownPackages, ["packages/ghost"]);
});

interface ILintDiagnostic {
  readonly code?: string;
  readonly filename?: string;
}

interface ILintReport {
  readonly diagnostics?: readonly ILintDiagnostic[];
}

/** The workspace package names (`packages/*` and `apps/*`). */
async function workspacePackages(): Promise<string[]> {
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as { workspace?: string[] };
  return (denoJson.workspace ?? [])
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter((entry) => entry.startsWith("packages/") || entry.startsWith("apps/"));
}

/** The workspace package a lint diagnostic belongs to, or null when it is outside one. */
function packageOf(filename: string, root: string): string | null {
  const path = filename.startsWith("file://") ? fromFileUrl(filename) : filename;
  if (!path.startsWith(`${root}/`)) return null;
  const parts = path.slice(root.length + 1).split("/");
  if (parts.length >= 2 && (parts[0] === "packages" || parts[0] === "apps")) return `${parts[0]}/${parts[1]}`;
  return null;
}

Deno.test("the committed ceilings file names only known rules and packages", async () => {
  const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")));
  const result = evaluateCeilings(ceilings, ceilings, RATCHETED_RULES, await workspacePackages());
  assertEquals(result.unknownRules, []);
  assertEquals(result.unknownPackages, []);
});

Deno.test("the whole-tree counts match the committed ceilings", async () => {
  // Parallel tests can remove files under the repo during one walk.
  // A bounded retry absorbs the resulting missing-file error.
  const MAX_LINT_ATTEMPTS = 3;
  let stdout = new Uint8Array();
  let stderr = new Uint8Array();
  for (let attempt = 1; attempt <= MAX_LINT_ATTEMPTS && stdout.length === 0; attempt++) {
    const command = new Deno.Command(Deno.execPath(), {
      // The repo lint scope, so a test-scope rule is held too (the no-argument form misses them).
      args: ["lint", "--json", "tests/", "packages/", "exaix-team/", "apps/"],
      cwd: REPO_ROOT,
      env: { EXAIX_LINT_RULES: RATCHETED_RULES.join(",") },
      stdout: "piped",
      stderr: "piped",
    });
    ({ stdout, stderr } = await command.output());
  }
  // deno lint exits non-zero whenever it reports violations, so the report on stdout is the signal.
  assert(stdout.length > 0, `whole-tree lint produced no report: ${new TextDecoder().decode(stderr).slice(-2000)}`);
  const report = JSON.parse(new TextDecoder().decode(stdout)) as ILintReport;

  const knownPackages = await workspacePackages();
  const counts: Record<string, Record<string, number>> = {};
  for (const diagnostic of report.diagnostics ?? []) {
    const code = diagnostic.code;
    const filename = diagnostic.filename;
    if (!code || !filename) continue;
    const pkg = packageOf(filename, REPO_ROOT);
    if (!pkg || !knownPackages.includes(pkg)) continue;
    counts[code] ??= {};
    counts[code][pkg] = (counts[code][pkg] ?? 0) + 1;
  }

  const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")));
  const result = evaluateCeilings(ceilings, counts, RATCHETED_RULES, knownPackages);
  assertEquals(result.over, [], `a count rose above its ceiling: ${JSON.stringify(result.over)}`);
  assertEquals(result.under, [], `a count fell; write the lower value back: ${JSON.stringify(result.under)}`);
  assertEquals(result.unknownRules, []);
  assertEquals(result.unknownPackages, []);
});
