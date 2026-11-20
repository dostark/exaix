#!/usr/bin/env -S deno run -A
/**
 * @module GoPortScenarioBaseline
 * @path scripts/go_port/scenario_baseline.ts
 * @description Runs the ci-smoke profile against the preserved snapshot and records per-scenario verdicts.
 * @architectural-layer Tooling
 * @dependencies [@std/fs, @std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/snapshot_manifest.json, exaix-dev-docs/completed/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/scenario_baseline.ts [--snapshot=<dir>] [--output=<dir>]
 */

import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { loadScenarioCatalog } from "../../tests/scenario_framework/runner/scenario_catalog.ts";
import { selectScenariosForExecution } from "../../tests/scenario_framework/runner/modes.ts";
import { ScenarioCiProfile } from "../../tests/scenario_framework/runner/config.ts";
import { contentHash } from "./snapshot_manifest.ts";
import { snapshotEnv } from "./preserve_snapshot.ts";

/** The two verdict values a scenario can record. */
type TVerdict = "pass" | "fail";

/** One scenario verdict in the baseline. */
export interface IScenarioVerdict {
  readonly id: string;
  readonly verdict: TVerdict;
  readonly evidence_hash: string;
}

/** The recorded ci-smoke baseline. */
export interface IScenarioBaseline {
  readonly profile: "ci-smoke";
  readonly catalog_hash: string;
  readonly run_id: string;
  readonly started_at: string;
  readonly verdicts: readonly IScenarioVerdict[];
}

/** The untrusted baseline shape validated before use. */
interface IBaselineInput {
  readonly profile?: string;
  readonly catalog_hash?: string;
  readonly run_id?: string;
  readonly started_at?: string;
  readonly verdicts?: readonly {
    readonly id?: string;
    readonly verdict?: string;
    readonly evidence_hash?: string;
  }[];
}

/** The fields of one runner manifest that this baseline reads. */
interface IRunManifest {
  readonly scenarioId?: string;
  readonly outcome?: string;
  readonly suite_score?: number;
  readonly steps?: readonly {
    readonly stepId?: string;
    readonly executionStatus?: string;
    readonly score?: number;
  }[];
}

/** One selected scenario's stable identity. */
interface ISelectedScenario {
  readonly id: string;
  readonly scenario_path: string;
}

const PROFILE = "ci-smoke";
const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const DEFAULT_SNAPSHOT = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-245-snapshot");
const DEFAULT_OUTPUT = join(DEFAULT_SNAPSHOT, "evidence", "baseline");

/** Accepts only the bounded ci-smoke profile. */
export function assertProfile(value: string): "ci-smoke" {
  if (value !== PROFILE) throw new Error(`unsupported profile '${value}'; use ${PROFILE}`);
  return PROFILE;
}

/** Validates a baseline record, or throws one message per missing field. */
export function parseBaseline(raw: IBaselineInput): IScenarioBaseline {
  const errors: string[] = [];
  if (raw.profile !== PROFILE) errors.push("profile: must be ci-smoke");
  if (typeof raw.catalog_hash !== "string" || raw.catalog_hash === "") errors.push("catalog_hash");
  if (typeof raw.run_id !== "string" || raw.run_id === "") errors.push("run_id");
  if (typeof raw.started_at !== "string" || raw.started_at === "") errors.push("started_at");
  if (!Array.isArray(raw.verdicts) || raw.verdicts.length === 0) errors.push("verdicts: at least one");
  for (const verdict of raw.verdicts ?? []) {
    if (typeof verdict.id !== "string" || verdict.id === "") errors.push("verdicts.id");
    if (verdict.verdict !== "pass" && verdict.verdict !== "fail") errors.push("verdicts.verdict");
    if (typeof verdict.evidence_hash !== "string" || verdict.evidence_hash === "") {
      errors.push("verdicts.evidence_hash");
    }
  }
  if (errors.length > 0) throw new Error(`baseline: ${errors.join("; ")}`);
  return raw as IScenarioBaseline;
}

/** Compares scenario ids, verdicts and evidence hashes. Metadata is ignored. */
export function compareBaselines(previous: IScenarioBaseline, current: IScenarioBaseline): string[] {
  const errors: string[] = [];
  if (previous.profile !== current.profile) errors.push("profile changed");
  if (previous.catalog_hash !== current.catalog_hash) errors.push("catalog hash changed");
  const before = new Map(previous.verdicts.map((verdict) => [verdict.id, verdict]));
  const after = new Map(current.verdicts.map((verdict) => [verdict.id, verdict]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(id);
    const right = after.get(id);
    if (left === undefined) errors.push(`new scenario ${id}`);
    else if (right === undefined) errors.push(`missing scenario ${id}`);
    else if (left.verdict !== right.verdict) errors.push(`verdict changed for ${id}`);
    else if (left.evidence_hash !== right.evidence_hash) errors.push(`evidence changed for ${id}`);
  }
  return errors;
}

/** Parses the optional replay baseline path. */
export function replayPath(args: readonly string[]): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith("--replay="));
  return arg?.slice("--replay=".length);
}

/** Returns the selected ids that produced no verdict. */
export function missingVerdicts(
  selectedIds: readonly string[],
  verdicts: readonly IScenarioVerdict[],
): string[] {
  const found = new Set(verdicts.map((verdict) => verdict.id));
  return selectedIds.filter((id) => !found.has(id));
}

/** Hashes the selected scenario paths and their manifest hashes. */
export async function catalogHashFor(
  selected: readonly ISelectedScenario[],
  manifestScenarios: Readonly<Record<string, string>>,
): Promise<string> {
  const scenarios: Record<string, string> = {};
  for (const scenario of selected) {
    const path = join("tests", "scenario_framework", scenario.scenario_path);
    scenarios[path] = manifestScenarios[path] ?? "";
  }
  return await contentHash({ scenarios });
}

/** Hashes the stable run result. Durations and timestamps are excluded. */
export async function normalizedRunHash(raw: IRunManifest): Promise<string> {
  const normalized = {
    scenarioId: raw.scenarioId ?? "",
    outcome: raw.outcome ?? "",
    suite_score: raw.suite_score ?? 0,
    steps: (raw.steps ?? []).map((step) => ({
      stepId: step.stepId ?? "",
      executionStatus: step.executionStatus ?? "",
      score: step.score ?? 0,
    })),
  };
  return await contentHash(normalized);
}

/** The runner command and environment that binds the snapshot CLI. */
export function runnerCommand(
  snapshot: string,
  output: string,
  scenario?: Opt<string, Reason.OptionalContext>,
): { args: string[]; env: Record<string, string> } {
  return {
    args: [
      "run",
      "-A",
      "tests/scenario_framework/runner/main.ts",
      "--profile",
      PROFILE,
      ...(scenario === undefined ? [] : ["--scenario", scenario]),
      "--output",
      output,
    ],
    env: { EXA_LLM_PROVIDER: "mock", ...snapshotEnv(snapshot) },
  };
}

/** Reads every run manifest under the output directory and hashes its evidence. */
async function readRunManifests(output: string): Promise<IScenarioVerdict[]> {
  const verdicts: IScenarioVerdict[] = [];
  try {
    for await (const entry of walk(output, { includeDirs: false })) {
      if (!entry.name.endsWith("run-manifest.json")) continue;
      const raw = JSON.parse(await Deno.readTextFile(entry.path)) as IRunManifest;
      if (typeof raw.scenarioId !== "string" || raw.scenarioId === "") continue;
      const verdict = raw.outcome === "success" ? "pass" : "fail";
      verdicts.push({
        id: raw.scenarioId,
        verdict,
        evidence_hash: await normalizedRunHash(raw),
      });
    }
  } catch {
    return [];
  }
  return verdicts.sort((left, right) => left.id.localeCompare(right.id));
}

/** Runs the profile and writes the baseline evidence. */
async function main(args: readonly string[]): Promise<number> {
  const value = (name: string): string | undefined => {
    const arg = args.find((candidate) => candidate.startsWith(`--${name}=`));
    return arg?.slice(name.length + 3);
  };
  const snapshot = resolve(value("snapshot") ?? DEFAULT_SNAPSHOT);
  const output = resolve(value("output") ?? DEFAULT_OUTPUT);
  const manifest = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "snapshot_manifest.json")),
  ) as { scenarios: Record<string, string> };
  await Deno.remove(output, { recursive: true }).catch(() => {});
  await Deno.mkdir(output, { recursive: true });
  const catalog = await loadScenarioCatalog({ frameworkHome: join(snapshot, "tests", "scenario_framework") });
  const selected = selectScenariosForExecution({ scenarios: catalog, profile: ScenarioCiProfile.SMOKE });
  const selectedEntries = catalog.filter((scenario) => selected.some((entry) => entry.id === scenario.id));
  const catalog_hash = await catalogHashFor(selectedEntries, manifest.scenarios);
  const verdicts: IScenarioVerdict[] = [];
  for (const scenario of selected) {
    const scenarioOutput = join(output, scenario.id);
    const command = runnerCommand(snapshot, scenarioOutput, scenario.id);
    const result = await new Deno.Command("deno", {
      args: command.args,
      cwd: snapshot,
      env: { ...Deno.env.toObject(), ...command.env },
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!result.success) console.error(`❌ scenario ${scenario.id} exited ${result.code}`);
    verdicts.push(...await readRunManifests(scenarioOutput));
  }
  const missing = missingVerdicts(selected.map((scenario) => scenario.id), verdicts);
  if (verdicts.length === 0 || missing.length > 0) {
    console.error(`❌ missing verdict(s): ${missing.join(", ") || "none"}`);
    return 1;
  }
  const baseline: IScenarioBaseline = {
    profile: PROFILE,
    catalog_hash,
    run_id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    verdicts,
  };
  const replay = replayPath(args);
  if (replay !== undefined) {
    let previous: IScenarioBaseline;
    try {
      previous = parseBaseline(JSON.parse(await Deno.readTextFile(resolve(replay))));
    } catch (error) {
      console.error(`❌ replay baseline read failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const errors = compareBaselines(previous, baseline);
    if (errors.length > 0) {
      for (const error of errors) console.error(`❌ ${error}`);
      return 1;
    }
    console.log("✅ replay matches the recorded baseline");
    return 0;
  }
  const path = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "scenario_verdicts.json");
  await Deno.writeTextFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`✅ ${verdicts.length} scenario verdict(s) written to ${path}`);
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
