#!/usr/bin/env -S deno run -A
/**
 * @module CheckScenarioDeclarative
 * @path scripts/check_scenario_declarative.ts
 * @description Manifests procedural (non-declarative) items in scenario YAML files. The
 *   scenario framework's principle (see issue #4) is that scenario YAMLs should be declarative:
 *   waits, assertions, and CLI invocations as typed steps — NOT inline shell logic (cp/sed/
 *   sqlite3/git/deno test). Every `type: shell` step is a violation; the category tells the
 *   migration where it belongs (journal-scoped criteria, framework setup helpers, native exactl
 *   steps, or a declarative test-runner criterion). Reports violations per file with the step
 *   line, and aggregates by category.
 *
 * Usage:
 *   deno run -A scripts/check_scenario_declarative.ts            # manifest report (exit 0)
 *   deno run -A scripts/check_scenario_declarative.ts --fail     # non-zero exit when violations exist
 *   deno run -A scripts/check_scenario_declarative.ts --json     # machine-readable report
 *   deno run -A scripts/check_scenario_declarative.ts --dir=<d>  # scan <d> instead of the scenarios dir
 * @architectural-layer Script
 * @dependencies [@std/yaml, @std/fs, @std/path]
 * @related-files [tests/scripts/check_scenario_declarative_test.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { parse as parseYaml } from "@std/yaml";
import { relative, resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";

/** Procedural categories a `shell` step can be classified into. */
export type ProceduralCategory =
  | "journal-sql"
  | "exactl-glue"
  | "test-run"
  | "sandbox-setup"
  | "filesystem-probe"
  | "inline-script";

export interface IScenarioProceduralViolation {
  file: string;
  line: number;
  step_id: string;
  category: ProceduralCategory;
  detail: string;
}

export interface IScenarioScanReport {
  violations: IScenarioProceduralViolation[];
  scenariosScanned: number;
  totalSteps: number;
  categories: Record<ProceduralCategory, number>;
  ok: boolean;
}

/** A step's args as parsed from YAML (strings, numbers, or booleans). */
type StepArg = string | number | boolean;

interface IStepShape {
  id?: Opt<string, Reason.OptionalInput>;
  type?: Opt<string, Reason.OptionalInput>;
  command?: Opt<string, Reason.OptionalInput>;
  args?: Opt<StepArg[], Reason.OptionalInput>;
}

interface IScenarioShape {
  steps?: Opt<IStepShape[], Reason.OptionalInput>;
}

export const PROCEDURAL_CATEGORIES: readonly ProceduralCategory[] = [
  "journal-sql",
  "exactl-glue",
  "test-run",
  "sandbox-setup",
  "filesystem-probe",
  "inline-script",
];

/** Classify a shell step's procedural category by its effective command text. */
export function classifyShellStep(command: Opt<string, Reason.OptionalInput>, args: StepArg[]): ProceduralCategory {
  const text = [command, ...(args ?? [])].map(String).join(" ").toLowerCase();
  if (/sqlite3/.test(text) && /journal\.db/.test(text)) return "journal-sql";
  if (/\bexactl\b/.test(text)) return "exactl-glue";
  if (/(^|\s)(deno test|npm test|npm run test|yarn test|pytest)/.test(text)) return "test-run";
  if (/(^|\s)(cp |mkdir |mv |rm |sed |git |printf |tee |curl |wget )/.test(text) || /\s>>?\s/.test(text)) {
    return "sandbox-setup";
  }
  if (/(^|\s)(grep |find |ls |test |head |tail |wc |cat )/.test(text)) return "filesystem-probe";
  return "inline-script";
}

/** Analyze one scenario YAML document: every `type: shell` step is a declarative violation. */
export function analyzeScenarioYaml(text: string): IScenarioProceduralViolation[] {
  const scenario = parseYaml(text) as IScenarioShape;
  const lines = text.split("\n");
  const violations: IScenarioProceduralViolation[] = [];
  for (const step of scenario?.steps ?? []) {
    if (step?.type !== "shell") continue;
    const stepId = step.id ?? "(unnamed)";
    const line = lines.findIndex((l) => l.includes(`- id: "${stepId}"`)) + 1;
    const category = classifyShellStep(step.command, step.args ?? []);
    const detail = [step.command, ...(step.args ?? [])].map(String).join(" ").slice(0, 100);
    violations.push({ file: "", line, step_id: stepId, category, detail });
  }
  return violations;
}

/** Scan every scenario YAML under `dir` and aggregate procedural violations. */
export async function scanScenarioDir(
  dir: string,
  baseForRelative: string = dir,
): Promise<IScenarioScanReport> {
  const violations: IScenarioProceduralViolation[] = [];
  let scenariosScanned = 0;
  let totalSteps = 0;
  const categories = Object.fromEntries(PROCEDURAL_CATEGORIES.map((c) => [c, 0])) as Record<
    ProceduralCategory,
    number
  >;

  const yamlPaths: string[] = [];
  async function walkDir(current: string): Promise<void> {
    for await (const entry of Deno.readDir(current)) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory) {
        await walkDir(full);
      } else if (entry.isFile && entry.name.endsWith(".yaml")) {
        yamlPaths.push(full);
      }
    }
  }
  await walkDir(dir);

  for (const yamlPath of yamlPaths.sort()) {
    const text = await Deno.readTextFile(yamlPath);
    scenariosScanned++;
    const scenario = parseYaml(text) as IScenarioShape;
    totalSteps += (scenario?.steps ?? []).length;
    const rel = relative(baseForRelative, yamlPath);
    for (const violation of analyzeScenarioYaml(text)) {
      categories[violation.category]++;
      violations.push({ ...violation, file: rel });
    }
  }

  return { violations, scenariosScanned, totalSteps, categories, ok: violations.length === 0 };
}

/** Render a human-readable report. */
export function renderReport(report: IScenarioScanReport): string {
  const lines: string[] = [];
  lines.push("Scenario YAML declarative-purity violations");
  lines.push("============================================");
  if (report.violations.length === 0) {
    lines.push("✅ No procedural shell steps found — all scenario steps are declarative.");
    return lines.join("\n");
  }
  lines.push(`Scenarios scanned: ${report.scenariosScanned}  Steps: ${report.totalSteps}`);
  lines.push("By category:");
  for (const category of PROCEDURAL_CATEGORIES) {
    if (report.categories[category] > 0) {
      lines.push(`  ${report.categories[category].toString().padStart(4)}  ${category}`);
    }
  }
  lines.push("By file:");
  let lastFile = "";
  for (const v of report.violations) {
    if (v.file !== lastFile) {
      lastFile = v.file;
      lines.push(`  ${v.file}`);
    }
    lines.push(`    L${String(v.line).padStart(4)}  [${v.category}] ${v.step_id}  ${v.detail}`);
  }
  lines.push(`TOTAL procedural violations: ${report.violations.length}`);
  return lines.join("\n");
}

if (import.meta.main) {
  const fail = Deno.args.includes("--fail");
  const asJson = Deno.args.includes("--json");
  const dirArg = Deno.args.find((a) => a.startsWith("--dir="));
  const dir = dirArg
    ? resolve(dirArg.slice("--dir=".length))
    : resolve(import.meta.dirname ?? ".", "../tests/scenario_framework/scenarios");

  const report = await scanScenarioDir(dir);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report));
  }
  if (fail && !report.ok) {
    Deno.exit(1);
  }
}
