/**
 * @module RuleCeilingsTest
 * @path packages/lint-policy/tests/rule_ceilings_test.ts
 * @description Exaix rule ceilings: the committed file names only known rules and packages, and the whole-tree counts match it. The evaluator itself is tested in the engine suite.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/tests/check_code_style_catalog_parity_test.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { classifyPath, type ICatalog, ruleSettings } from "@dostark/unslop-ts";
import { matchesAnyGlob } from "../../../unslop-ts/src/engine/glob.ts";
import { skipReasonOf } from "../../../unslop-ts/src/engine/rule_gate.ts";
import { assertRuleEvidence, type ILintReport, parseDenoLintOutput } from "../../../unslop-ts/src/cli/rule_report.ts";
import { formatTraceRecord } from "../../../unslop-ts/src/engine/trace.ts";
import { POLICY_CATALOG } from "../src/policy_config.ts";
import { EXAIX_REGISTRY } from "../src/rule_packs.ts";
import { evaluateCeilings, type ICeilings } from "../../../unslop-ts/src/cli/rule_ceiling.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
const RATCHETED_RULES = [
  "exaix/max-cyclomatic-complexity",
  "exaix/max-cognitive-complexity",
  "exaix/max-function-lines",
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

const PHASE_230_RULES = new Set([
  "import-placement",
  "re-export-imported",
  "exported-interface-placement",
  "no-interface-rename-on-import",
  "long-comment",
  "ephemeral-comment",
  "test-inline-multiline-fixture",
  "no-constant-substring-assert",
  "promise-response-return",
  "magic-union-type",
  "no-object-parameters",
  "no-unsafe-dictionary",
  "no-typeof-escape",
  "no-explicit-unknown",
  "no-repeated-assert-call",
  "no-boolean-assert",
].map((key) => `exaix/${key}`));

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

/** Counts owned rule scopes and retains production-only counts for unrelated rules. */
function countsOf(
  report: Pick<ILintReport, "diagnostics">,
  root: string,
  knownPackages: readonly string[],
  catalog: ICatalog = POLICY_CATALOG,
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const diagnostic of report.diagnostics ?? []) {
    const code = diagnostic.code;
    const filename = diagnostic.filename;
    if (!code || !filename) throw new Error("diagnostic is missing its code or filename");
    const relative = relativePathOf(filename, root);
    if (relative === null) throw new Error(`diagnostic outside the repository: ${filename}`);
    if (PHASE_230_RULES.has(code)) {
      const pathClass = classifyPath(relative, catalog.scopes);
      const ignored = matchesAnyGlob(relative, (catalog.ignore ?? []).map((entry) => entry.glob));
      if (ignored || skipReasonOf(relative, pathClass, ruleSettings(catalog, code, EXAIX_REGISTRY))) continue;
    } else if (isTestScope(relative)) continue;
    const pkg = packageOf(filename, root);
    if (!pkg || !knownPackages.includes(pkg)) throw new Error(`unregistered owner: ${relative}`);
    counts[code] ??= {};
    counts[code][pkg] = (counts[code][pkg] ?? 0) + 1;
  }
  return counts;
}

/** Applies the phase-owned bucket policy before evaluation. */
function ceilingCounts(ceilings: ICeilings, counts: ICeilings): ICeilings {
  return Object.fromEntries(
    Object.entries(ceilings).map(([rule, row]) => [
      rule,
      PHASE_230_RULES.has(rule)
        ? counts[rule] ?? {}
        : Object.fromEntries(Object.keys(row).map((owner) => [owner, counts[rule]?.[owner] ?? 0])),
    ]),
  );
}

Deno.test("inventory-scopes-and-buckets: unrelated rules retain their committed bucket policy", () => {
  const ceilings: ICeilings = { "exaix/max-params": { "packages/core": 1 }, "exaix/no-explicit-unknown": {} };
  const counts: ICeilings = {
    "exaix/max-params": { "packages/execution": 2 },
    "exaix/no-explicit-unknown": { tests: 1 },
  };
  const result = evaluateCeilings(ceilings, ceilingCounts(ceilings, counts), Object.keys(ceilings), [
    "packages/core",
    "packages/execution",
    "tests",
  ]);
  assertEquals(result.over, [{
    rule: "exaix/no-explicit-unknown",
    packageName: "tests",
    count: 1,
    ceiling: 0,
    delta: 1,
  }]);
});

/** Validates the host report and each selected rule's plugin observations. */
function validatedInventory(
  output: { readonly code: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array },
  runId: string,
  rules: readonly string[],
): ILintReport {
  const decoder = new TextDecoder();
  const stderr = decoder.decode(output.stderr);
  const report = parseDenoLintOutput(decoder.decode(output.stdout), output.code, stderr);
  for (const rule of rules) {
    assertRuleEvidence({ rule, runId, stderr, checkedFiles: report.checked_files, cwd: REPO_ROOT });
  }
  const unrelated = report.diagnostics.filter((diagnostic) => !rules.includes(diagnostic.code ?? ""));
  if (unrelated.length > 0) console.log(`unrelated host diagnostics: ${JSON.stringify(unrelated)}`);
  return { ...report, diagnostics: report.diagnostics.filter((diagnostic) => rules.includes(diagnostic.code ?? "")) };
}

Deno.test("inventory-fails-closed: reports and observed populations must be complete", () => {
  const runId = "inventory-control";
  const rule = "exaix/import-placement";
  const file = "packages/core/src/probe.ts";
  const observed = formatTraceRecord({ kind: "observed", runId, plugin: "exaix", file, rule: "internal-coverage" });
  const checked = formatTraceRecord({ kind: "checked", runId, plugin: "exaix", file, rule });
  const valid = { diagnostics: [], errors: [], checked_files: [`${REPO_ROOT}/${file}`] };
  const encode = new TextEncoder();
  const validate = (report: string, code = 0, stderr = `${observed}\n${checked}`) =>
    validatedInventory(
      {
        code,
        stdout: encode.encode(report),
        stderr: encode.encode(stderr),
      },
      runId,
      [rule],
    );
  assertEquals(validate(JSON.stringify(valid)).diagnostics, []);
  for (
    const report of [
      "",
      "{",
      "null",
      "{}",
      JSON.stringify({ ...valid, errors: [{}] }),
      JSON.stringify({ ...valid, checked_files: undefined }),
    ]
  ) {
    assertThrows(() => validate(report));
  }
  assertThrows(() => validate(JSON.stringify(valid), 2), Error, "status 2");
  assertThrows(() => validate(JSON.stringify(valid), 1), Error, "exited 1");
  assertThrows(() => validate(JSON.stringify(valid), 0, ""), Error, "no observation");
  assertThrows(() => validate(JSON.stringify(valid), 0, observed), Error, "did not evaluate");
  assertThrows(
    () =>
      validate(
        JSON.stringify({ ...valid, checked_files: [...valid.checked_files, `${REPO_ROOT}/tests/missed_test.ts`] }),
      ),
    Error,
    "incomplete coverage",
  );
});

Deno.test("inventory-scopes-and-buckets: owned rules count tests and preserve other production ceilings", () => {
  const diagnostic = (code: string, path: string) => ({ code: `exaix/${code}`, filename: `${REPO_ROOT}/${path}` });
  const report: Pick<ILintReport, "diagnostics"> = {
    diagnostics: [
      diagnostic("no-explicit-unknown", "tests/a_test.ts"),
      diagnostic("no-explicit-unknown", "packages/execution/tests/b.ts"),
      diagnostic("no-explicit-unknown", "packages/execution/src/c.ts"),
      diagnostic("no-boolean-assert", "scripts/probe_test.ts"),
      diagnostic("no-boolean-assert", "scripts/probe.ts"),
      diagnostic("magic-union-type", "packages/execution/tests/d.ts"),
      diagnostic("magic-union-type", "packages/execution/src/d.ts"),
      diagnostic("max-function-lines", "packages/execution/tests/e.ts"),
      diagnostic("max-function-lines", "packages/execution/src/e.ts"),
      diagnostic("max-params", "packages/execution/tests/f.ts"),
      diagnostic("max-params", "packages/execution/src/f.ts"),
      diagnostic("no-explicit-unknown", "packages/execution/tests/fixtures/g.ts"),
      diagnostic("no-interface-rename-on-import", "packages/core/src/parsing/markdown.ts"),
      diagnostic("re-export-imported", "packages/execution/mod.ts"),
      diagnostic("no-explicit-unknown", "scripts/check_code_style.ts"),
      diagnostic("no-explicit-unknown", "scripts/__temp_probe.ts"),
      diagnostic("no-explicit-unknown", "exaix-team/packages/ai/tests/g.ts"),
    ],
  };
  assertEquals(countsOf(report, REPO_ROOT, ["packages/execution", "packages/core", ...ROOT_BUCKETS]), {
    "exaix/no-explicit-unknown": { tests: 1, "packages/execution": 2, scripts: 1, "exaix-team": 1 },
    "exaix/no-boolean-assert": { scripts: 1 },
    "exaix/magic-union-type": { "packages/execution": 1 },
    "exaix/max-function-lines": { "packages/execution": 1 },
    "exaix/max-params": { "packages/execution": 1 },
  });
});

Deno.test("inventory-scopes-and-buckets: compiled include restrictions and fixture skips remain effective", () => {
  const rule = "exaix/no-explicit-unknown";
  const catalog: ICatalog = {
    ...POLICY_CATALOG,
    rules: {
      ...POLICY_CATALOG.rules,
      [rule]: { ...POLICY_CATALOG.rules[rule], include: ["packages/core/src/**"] },
    },
  };
  const report = {
    diagnostics: [
      { code: rule, filename: `${REPO_ROOT}/packages/core/src/a.ts` },
      { code: rule, filename: `${REPO_ROOT}/packages/core/tests/a_test.ts` },
      { code: rule, filename: `${REPO_ROOT}/tests/a_test.ts` },
    ],
  };
  assertEquals(countsOf(report, REPO_ROOT, ["packages/core", "tests"], catalog), { [rule]: { "packages/core": 1 } });
});

Deno.test("inventory-scopes-and-buckets: unknown intended owners fail instead of disappearing", () => {
  const report: Pick<ILintReport, "diagnostics"> = {
    diagnostics: [{ code: "exaix/no-explicit-unknown", filename: `${REPO_ROOT}/packages/unregistered/tests/a.ts` }],
  };
  assertThrows(() => countsOf(report, REPO_ROOT, ROOT_BUCKETS), Error, "unregistered owner");
});

Deno.test("inventory-scopes-and-buckets: new and removed-zero buckets remain protected", () => {
  const rule = "exaix/no-explicit-unknown";
  const measured = countsOf(
    { diagnostics: [{ code: rule, filename: `${REPO_ROOT}/tests/a_test.ts` }] },
    REPO_ROOT,
    ROOT_BUCKETS,
  );
  const baselines: ICeilings[] = [{ [rule]: {} }, { [rule]: { scripts: 1 } }];
  for (const ceilings of baselines) {
    const result = evaluateCeilings(ceilings, ceilingCounts(ceilings, measured), [rule], ROOT_BUCKETS);
    assertEquals(result.over, [{ rule, packageName: "tests", ceiling: 0, count: 1, delta: 1 }]);
  }
});

Deno.test("the committed ceilings file names only known rules and packages", async () => {
  const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")));
  const result = evaluateCeilings(ceilings, ceilings, RATCHETED_RULES, await workspacePackages());
  assertEquals(result.unknownRules, []);
  assertEquals(result.unknownPackages, []);
});

Deno.test({
  name: "the whole-tree counts stay at or below the committed ceilings",
  fn: async () => {
    const runId = crypto.randomUUID();
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["lint", "--rules-tags=", "--json", "tests/", "packages/", "exaix-team/", "apps/", "scripts/"],
      cwd: REPO_ROOT,
      env: { EXAIX_LINT_RULES: RATCHETED_RULES.join(","), EXAIX_LINT_TRACE: runId },
      signal: AbortSignal.timeout(300_000),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const report = validatedInventory(output, runId, RATCHETED_RULES);

    const knownPackages = await workspacePackages();
    const counts = countsOf(report, REPO_ROOT, knownPackages);
    console.log(
      `Phase 230 scoped counts: ${
        JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([rule]) => PHASE_230_RULES.has(rule))))
      }`,
    );

    const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")));
    const result = evaluateCeilings(ceilings, ceilingCounts(ceilings, counts), RATCHETED_RULES, knownPackages);
    assertEquals(result.over, [], `a count rose above its ceiling: ${JSON.stringify(result.over)}`);
    // A fall is progress, not a failure: the ceiling only holds a count from rising.
    if (result.under.length > 0) console.log(`ceilings above the measured count: ${JSON.stringify(result.under)}`);
    assertEquals(result.unknownRules, []);
    assertEquals(result.unknownPackages, []);
  },
});

Deno.test("exaix-ceilings-match: the three complexity rows cover the measured buckets", async () => {
  const ceilings = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "packages/lint-policy/rule_ceilings.json")),
  ) as Record<string, Record<string, number>>;
  const known = await workspacePackages();
  const rules = [
    "exaix/max-cyclomatic-complexity",
    "exaix/max-cognitive-complexity",
    "exaix/max-function-lines",
  ];
  for (const rule of rules) {
    const row = ceilings[rule];
    assert(row !== undefined, rule);
    for (const packageName of Object.keys(row)) assert(known.includes(packageName), `${rule}: ${packageName}`);
  }
  assertEquals(evaluateCeilings(ceilings, ceilings, RATCHETED_RULES, known).over, []);
  const lower = structuredClone(ceilings);
  lower["exaix/max-cyclomatic-complexity"]["packages/ai"] -= 1;
  const reduced = evaluateCeilings(ceilings, lower, RATCHETED_RULES, known);
  assertEquals(reduced.under.length > 0, true);
  assertEquals(reduced.over, []);
});
