/**
 * @module SharedTreeParityTest
 * @path packages/lint-policy/tests/shared_tree_parity_test.ts
 * @description Compares the moved rules with the style checker of the Phase 227 base commit on the bytes of the current tree, and checks the dropped surfaces.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, typescript]
 * @related-files [packages/lint-policy/tests/helpers/phase_base_checker.ts, packages/lint-policy/tests/helpers/script_port_parity.ts]
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { fromFileUrl, globToRegExp, join } from "@std/path";
import ts from "typescript";
import catalogJson from "./fixtures/catalog_v1.json" with { type: "json" };
import { GIT_FILE_SOURCE } from "./helpers/port_migration.ts";
import { loadPortTables } from "./helpers/port_tables.ts";
import { runBaseChecker, withPhaseBaseCheckers } from "./helpers/phase_base_checker.ts";
import {
  compareProductionFindings,
  type IFilePartition,
  type IProductionParity,
  type IRuleFinding,
  parseStyleFindings,
  partitionFiles,
  undeclaredDrops,
} from "./helpers/script_port_parity.ts";

const REPO_ROOT = fromFileUrl(new URL("../../..", import.meta.url));
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".yaml", ".yml", ".toml", ".jsonc"];
const PLUGIN_EXTENSIONS = [".ts", ".tsx"];
const PLUGIN_ROOTS = ["tests/", "packages/", "exaix-team/", "apps/", "scripts/"];
const PLUGIN_PREFIX = "exaix/";
const BOUNDARY_RULE = "import-boundaries";
const BOUNDARY_ZONE = /^Boundary '([^']+)':/;
const IGNORE_PREFIX = "deno-lint-ignore exaix/";
const COMPLETION_LINE = "style check completed";
/** A zone that has a different id from the script rule it replaced. */
const ZONE_TO_SCRIPT_ID: Readonly<Record<string, string>> = { "tui-boundary-helpers-tests": "tui-boundary-helpers" };

interface ICatalogEntry {
  readonly severity: string;
  readonly optIn?: boolean;
  readonly ignore?: readonly { readonly glob: string }[];
}

interface IMovedRule {
  readonly scriptId: string;
  readonly pluginKey: string;
  readonly dropped: readonly string[];
}

interface ISharedTree {
  readonly partition: IFilePartition;
  readonly moved: readonly IMovedRule[];
  readonly parked: ReadonlySet<string>;
  readonly baselineOutput: string;
  readonly parity: IProductionParity;
  readonly diagnosticCount: number;
}

const ignoreGlobs = ((catalogJson as { ignore?: readonly { glob: string }[] }).ignore ?? []).map((entry) =>
  globToRegExp(entry.glob, { extended: true, globstar: true })
);

function hasExtension(file: string, extensions: readonly string[]): boolean {
  return extensions.some((extension) => file.endsWith(extension));
}

function scriptCovers(file: string): boolean {
  return hasExtension(file, SCRIPT_EXTENSIONS) && !ignoreGlobs.some((pattern) => pattern.test(file));
}

function pluginCovers(file: string): boolean {
  return hasExtension(file, PLUGIN_EXTENSIONS) && PLUGIN_ROOTS.some((root) => file.startsWith(root)) &&
    !ignoreGlobs.some((pattern) => pattern.test(file));
}

/** The surface of a file that only one side reads, named as the scope table names a dropped surface. */
function surfaceOf(file: string): string {
  const extension = file.slice(file.lastIndexOf(".") + 1);
  return hasExtension(file, PLUGIN_EXTENSIONS) ? "non-root-ts" : extension;
}

async function movedRules(): Promise<IMovedRule[]> {
  const tables = await loadPortTables();
  return tables.rules
    .filter((row) => row.ported && row.origin === "ported" && row.id !== "magic-literals")
    .map((row) => {
      const generic = row.parts.find((part) => part.pack !== "exaix");
      assert(generic !== undefined, `${row.id} has no engine part`);
      return { scriptId: row.id, pluginKey: generic.key, dropped: row.scope.dropped };
    });
}

function parkedKeys(): Set<string> {
  const rules = catalogJson.rules as Record<string, ICatalogEntry>;
  return new Set(
    Object.entries(rules)
      .filter(([id, entry]) => id.startsWith(PLUGIN_PREFIX) && entry.severity === "off" && entry.optIn === true)
      .map(([id]) => id.slice(PLUGIN_PREFIX.length)),
  );
}

interface ILintDiagnostic {
  readonly code?: string;
  readonly message?: string;
  readonly filename?: string;
  readonly range?: { readonly start?: { readonly line?: number } };
}

async function pluginFindings(
  moved: readonly IMovedRule[],
): Promise<{ findings: IRuleFinding[]; diagnosticCount: number }> {
  const keys = new Set(moved.map((rule) => rule.pluginKey));
  const selection = [...keys].map((key) => `${PLUGIN_PREFIX}${key}`).join(",");
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["lint", "--json", ...PLUGIN_ROOTS],
    cwd: REPO_ROOT,
    env: { EXAIX_LINT_RULES: selection },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const report = JSON.parse(new TextDecoder().decode(result.stdout)) as { diagnostics?: ILintDiagnostic[] };
  const toScript = new Map(moved.map((rule) => [rule.pluginKey, rule.scriptId]));
  const findings: IRuleFinding[] = [];
  for (const diagnostic of report.diagnostics ?? []) {
    const code = diagnostic.code ?? "";
    if (!code.startsWith(PLUGIN_PREFIX) || diagnostic.filename === undefined) continue;
    const key = code.slice(PLUGIN_PREFIX.length);
    const zone = key === BOUNDARY_RULE ? BOUNDARY_ZONE.exec(diagnostic.message ?? "")?.[1] : undefined;
    const rule = zone === undefined ? toScript.get(key) : (ZONE_TO_SCRIPT_ID[zone] ?? zone);
    if (rule === undefined) continue;
    const file = fromFileUrl(diagnostic.filename).replace(`${REPO_ROOT}`, "");
    findings.push({ rule, file, line: diagnostic.range?.start?.line ?? 0 });
  }
  return { findings, diagnosticCount: (report.diagnostics ?? []).length };
}

/** True when the line shares text with a string, template, or comment, which AST rules do not read as code. */
function lineHoldsLiteralText(text: string, line: number): boolean {
  const source = ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
  const starts = source.getLineStarts();
  const begin = starts[line - 1] ?? 0;
  const end = starts[line] ?? text.length;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node);
    if (literal && node.getStart(source) < end && node.getEnd() > begin) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  if (found) return true;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const comment = token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
    if (comment && scanner.getTokenPos() < end && scanner.getTextPos() > begin) return true;
  }
  return false;
}

async function readLines(file: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(join(REPO_ROOT, file));
  } catch {
    return null;
  }
}

async function collect(): Promise<ISharedTree> {
  const moved = await movedRules();
  const parked = parkedKeys();
  const baseline = await withPhaseBaseCheckers((hosts) => runBaseChecker(hosts.style));
  const scriptIds = new Set(moved.map((rule) => rule.scriptId));
  const baselineFindings = parseStyleFindings(baseline.output, REPO_ROOT).filter((finding) =>
    scriptIds.has(finding.rule)
  );
  const current = await pluginFindings(moved);
  const tracked = await GIT_FILE_SOURCE.list();
  const partition = partitionFiles(tracked, { script: scriptCovers, plugin: pluginCovers });
  const shared = new Set(partition.shared);
  const parkedScriptIds = new Set(moved.filter((rule) => parked.has(rule.pluginKey)).map((rule) => rule.scriptId));
  const texts = new Map<string, string | null>();
  for (const file of new Set(baselineFindings.map((finding) => finding.file))) texts.set(file, await readLines(file));
  const parity = compareProductionFindings({
    baseline: baselineFindings,
    current: current.findings,
    explainMissing: (finding) => {
      if (!pluginCovers(finding.file)) return "scope loss: the plugin reads TypeScript under its lint roots only";
      const text = texts.get(finding.file);
      if (text === null || text === undefined) return null;
      const lines = text.split("\n");
      const near = [lines[finding.line - 2] ?? "", lines[finding.line - 1] ?? ""].join("\n");
      if (near.includes(IGNORE_PREFIX)) return "suppressed by a migrated deno-lint-ignore comment";
      if (lineHoldsLiteralText(text, finding.line)) return "script matched text inside a literal or a comment";
      return null;
    },
    explainExtra: (finding) =>
      parkedScriptIds.has(finding.rule) && shared.has(finding.file)
        ? "parked rule finding held by rule_ceilings.json"
        : null,
  });
  return {
    partition,
    moved,
    parked,
    baselineOutput: baseline.output,
    parity,
    diagnosticCount: current.diagnosticCount,
  };
}

let cached: Promise<ISharedTree> | null = null;
function sharedTree(): Promise<ISharedTree> {
  cached ??= collect();
  return cached;
}

Deno.test("ported_rules_match_baseline_on_shared_production_files", async () => {
  const tree = await sharedTree();
  assertEquals(tree.parity.unexplainedMissing, [], "a baseline finding is absent without a reason");
  assertEquals(tree.parity.unexplainedExtra, [], "a new finding is present without a reason");
  const reasons = new Set(tree.parity.accepted.map((entry) => entry.reason));
  for (const reason of reasons) {
    assert(
      /^(scope loss|suppressed by a migrated|script matched text|parked rule finding)/.test(reason),
      `unknown reason: ${reason}`,
    );
  }
});

Deno.test("shared_tree_inventory_is_nonempty_and_consumed", async () => {
  const tree = await sharedTree();
  assert(tree.partition.shared.length > 1000, `only ${tree.partition.shared.length} shared files`);
  assertNotEquals(tree.partition.scriptOnly.length, 0, "no dropped surface was found");
  assert(tree.baselineOutput.includes(COMPLETION_LINE), "the base checker did not finish a scan");
  assert(tree.diagnosticCount > 0, "the plugin run reported no diagnostic at all");
  assert(tree.parity.compared > 0, "no finding was compared");
  assert(tree.moved.length >= 30, `only ${tree.moved.length} moved rules were compared`);
  const declared = new Set(tree.moved.flatMap((rule) => rule.dropped));
  assertEquals(undeclaredDrops(tree.partition, surfaceOf, declared), [], "a one-sided file has no declared reason");
});

const SAMPLE: IRuleFinding = { rule: "dynamic-import", file: "packages/a/src/x.ts", line: 4 };

Deno.test("shared_tree_parity_rejects_missing_extra_and_unlisted_drops", () => {
  const never = () => null;
  const missing = compareProductionFindings({
    baseline: [SAMPLE],
    current: [],
    explainMissing: never,
    explainExtra: never,
  });
  assertEquals(missing.unexplainedMissing, [SAMPLE]);
  const extra = compareProductionFindings({
    baseline: [],
    current: [SAMPLE],
    explainMissing: never,
    explainExtra: never,
  });
  assertEquals(extra.unexplainedExtra, [SAMPLE]);
  const explained = compareProductionFindings({
    baseline: [SAMPLE],
    current: [],
    explainMissing: () => "scope loss",
    explainExtra: never,
  });
  assertEquals(explained.accepted.length, 1);
  assertEquals(explained.unexplainedMissing, []);
  const equal = compareProductionFindings({
    baseline: [SAMPLE],
    current: [{ ...SAMPLE }],
    explainMissing: never,
    explainExtra: never,
  });
  assertEquals(equal.compared, 1);
  const partition = partitionFiles(["packages/a/src/x.ts", "packages/a/src/y.ts", "ci.yml"], {
    script: () => true,
    plugin: (file) => file !== "packages/a/src/y.ts" && file !== "ci.yml",
  });
  assertEquals(undeclaredDrops(partition, surfaceOf, new Set(["yml"])), ["packages/a/src/y.ts"]);
  assertEquals(undeclaredDrops(partition, surfaceOf, new Set(["yml", "non-root-ts"])), []);
});
