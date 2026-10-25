/**
 * @module RuleCeilingsTest
 * @path packages/lint-policy/tests/rule_ceilings_test.ts
 * @description Exaix rule ceilings: the committed file names only known rules and packages, and the whole-tree counts match it. The evaluator itself is tested in the engine suite.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/tests/check_code_style_catalog_parity_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { evaluateCeilings } from "../../../unslop-ts/src/cli/rule_ceiling.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
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
  "exaix/re-export-imported",
  "exaix/import-placement",
  "exaix/exported-interface-placement",
  "exaix/magic-union-type",
  "exaix/promise-response-return",
  "exaix/long-comment",
  "exaix/ephemeral-comment",
  "exaix/no-interface-rename-on-import",
  "exaix/max-params",
  "exaix/test-inline-multiline-fixture",
];
const ROOT_BUCKETS = ["tests", "exaix-team", "scripts"];

interface ILintDiagnostic {
  readonly code?: string;
  readonly filename?: string;
}

interface ILintReport {
  readonly diagnostics?: readonly ILintDiagnostic[];
}

/** The workspace package names (`packages/*` and `apps/*`) and the root buckets for `tests/`, `exaix-team/`, and `scripts/`. */
async function workspacePackages(): Promise<string[]> {
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as { workspace?: string[] };
  const workspace = (denoJson.workspace ?? [])
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter((entry) => entry.startsWith("packages/") || entry.startsWith("apps/"));
  return [...workspace, ...ROOT_BUCKETS];
}

/** The workspace package a lint diagnostic belongs to, or null when it is outside one. */
function packageOf(filename: string, root: string): string | null {
  const path = filename.startsWith("file://") ? fromFileUrl(filename) : filename;
  if (!path.startsWith(`${root}/`)) return null;
  const parts = path.slice(root.length + 1).split("/");
  if (parts.length >= 2 && (parts[0] === "packages" || parts[0] === "apps")) return `${parts[0]}/${parts[1]}`;
  if (ROOT_BUCKETS.includes(parts[0])) return parts[0];
  return null;
}

/** The catalog's test globs, applied to a repo-relative path. */
const TEST_SCOPE_PATTERNS: readonly RegExp[] = [
  /^tests\//,
  /\/tests\//,
  /_test\.tsx?$/,
  /\.test\.tsx?$/,
];

/** True when a repo-relative path is test scope (the catalog's test globs). */
function isTestScope(relativePath: string): boolean {
  return TEST_SCOPE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/** Repo-relative POSIX path of one diagnostic filename. */
function relativePathOf(filename: string, root: string): string | null {
  const path = filename.startsWith("file://") ? fromFileUrl(filename) : filename;
  if (!path.startsWith(`${root}/`)) return null;
  return path.slice(root.length + 1);
}

/** Counts production diagnostics by rule and package. Test scope never raises a ceiling. */
function countsOf(
  report: ILintReport,
  root: string,
  knownPackages: readonly string[],
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const diagnostic of report.diagnostics ?? []) {
    const code = diagnostic.code;
    const filename = diagnostic.filename;
    if (!code || !filename) continue;
    if (filename.includes("__temp_")) continue;
    const relative = relativePathOf(filename, root);
    if (relative === null || isTestScope(relative)) continue;
    const pkg = packageOf(filename, root);
    if (!pkg || !knownPackages.includes(pkg)) continue;
    counts[code] ??= {};
    counts[code][pkg] = (counts[code][pkg] ?? 0) + 1;
  }
  return counts;
}

Deno.test("whole-tree-ceilings-production-only: test-scope diagnostics never raise a ceiling", () => {
  const report: ILintReport = {
    diagnostics: [
      { code: "exaix/no-explicit-unknown", filename: `${REPO_ROOT}/tests/a_test.ts` },
      { code: "exaix/no-explicit-unknown", filename: `${REPO_ROOT}/packages/execution/tests/b.ts` },
      { code: "exaix/no-explicit-unknown", filename: `${REPO_ROOT}/packages/execution/src/c.ts` },
    ],
  };
  const counts = countsOf(report, REPO_ROOT, ["packages/execution", "tests"]);
  assertEquals(counts["exaix/no-explicit-unknown"]["packages/execution"], 1);
  assertEquals(counts["exaix/no-explicit-unknown"]["tests"], undefined);
});

Deno.test("the committed ceilings file names only known rules and packages", async () => {
  const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")));
  const result = evaluateCeilings(ceilings, ceilings, RATCHETED_RULES, await workspacePackages());
  assertEquals(result.unknownRules, []);
  assertEquals(result.unknownPackages, []);
});

Deno.test({
  name: "the whole-tree counts match the committed ceilings",
  fn: async () => {
    // Parallel tests can remove files under the repo during one walk.
    // A bounded retry absorbs the resulting missing-file error.
    const MAX_LINT_ATTEMPTS = 3;
    let stdout = new Uint8Array();
    let stderr = new Uint8Array();
    for (let attempt = 1; attempt <= MAX_LINT_ATTEMPTS && stdout.length === 0; attempt++) {
      const command = new Deno.Command(Deno.execPath(), {
        // The repo lint scope, so a test-scope rule is held too (the no-argument form misses them).
        args: ["lint", "--json", "tests/", "packages/", "exaix-team/", "apps/", "scripts/"],
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
    const counts = countsOf(report, REPO_ROOT, knownPackages);

    const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")));
    const result = evaluateCeilings(ceilings, counts, RATCHETED_RULES, knownPackages);
    assertEquals(result.over, [], `a count rose above its ceiling: ${JSON.stringify(result.over)}`);
    assertEquals(result.under, [], `a count fell; write the lower value back: ${JSON.stringify(result.under)}`);
    assertEquals(result.unknownRules, []);
    assertEquals(result.unknownPackages, []);
  },
});
