#!/usr/bin/env -S deno run -A
/**
 * @module GoPortD24Decision
 * @path scripts/go_port/d24_decision.ts
 * @description Computes and records the D24 forecast from the Phase 245 evidence.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/cost_comparison.json, exaix-dev-docs/completed/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/d24_decision.ts [--output=<dir>]
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";
import type { IPackageCost } from "./cost_comparison.ts";

/** The forecast input. */
export interface ID24Input {
  readonly budget_hours: number;
  readonly budget_spend_usd: number;
  readonly measured_spend_usd: number;
  readonly extrapolated_hours: number;
  readonly packages: readonly IPackageCost[];
  readonly owner?: string;
}

/** The evidence references the forecast cross-checks. */
export interface ID24Evidence {
  readonly manifest_hash: string;
  readonly snapshot_manifest_hash: string;
  readonly verdict_count: number;
  readonly benchmark_modes: number;
  readonly cost_packages: number;
}

/** The three forecast values. */
type TDecision = "proceed" | "revise" | "stop";

/** The recorded forecast. */
export interface ID24Decision {
  readonly decision: TDecision;
  readonly measured_hours: number;
  readonly extrapolated_hours: number;
  readonly measured_spend_usd: number;
  readonly budget_hours: number;
  readonly budget_spend_usd: number;
  readonly hours_multiple: number;
  readonly spend_multiple: number;
  readonly comparison_rule: "both";
  readonly reasons: readonly string[];
  readonly owner: string;
  readonly signed_at: string;
}

interface ICostFile {
  readonly packages: readonly IPackageCost[];
  readonly extrapolation: { readonly high: number };
}

interface IVerdictFile {
  readonly verdicts: readonly { readonly id: string }[];
}

interface IBenchmarkFile {
  readonly modes: readonly { readonly mode: string }[];
}

interface IPrerequisitesFile {
  readonly owner: string;
  readonly budget: { readonly hours: number; readonly spend_usd: number };
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const EVIDENCE_DIR = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port");
const THRESHOLD = 2;
const ACTIVITY_COUNT = 6;

/** Returns every evidence reference that is missing or inconsistent. */
export function evidenceErrors(evidence: ID24Evidence): string[] {
  const errors: string[] = [];
  if (evidence.manifest_hash === "") errors.push("manifest_hash: empty");
  if (evidence.snapshot_manifest_hash !== evidence.manifest_hash) {
    errors.push("snapshot_manifest_hash: does not match the manifest");
  }
  if (evidence.verdict_count <= 0) errors.push("verdict_count: no scenario verdicts");
  if (evidence.benchmark_modes <= 0) errors.push("benchmark_modes: no benchmark modes");
  if (evidence.cost_packages <= 0) errors.push("cost_packages: no cost arms");
  return errors;
}

/** Computes the D24 forecast. Incomplete measurements cannot proceed. */
export function decide(input: ID24Input): ID24Decision {
  if (input.packages.length === 0) throw new Error("packages: at least one cost entry is required");
  if (input.budget_hours <= 0) throw new Error("budget_hours: must be positive");
  if (input.budget_spend_usd <= 0) throw new Error("budget_spend_usd: must be positive");
  if (input.extrapolated_hours < 0) throw new Error("extrapolated_hours: must not be negative");
  if (input.measured_spend_usd < 0) throw new Error("measured_spend_usd: must not be negative");
  const measuredHours = input.packages.reduce((sum, entry) => sum + entry.total, 0);
  const hoursMultiple = input.extrapolated_hours / input.budget_hours;
  const spendMultiple = input.measured_spend_usd / input.budget_spend_usd;
  const arms = new Set(input.packages.map((entry) => entry.arm));
  const complete = arms.has("converter-assisted") && arms.has("agent-only") &&
    input.packages.every((entry) =>
      entry.extent === "conversion" && entry.total > 0 && entry.hours.review > 0 &&
      entry.spend_usd > 0 && entry.time_log.length === ACTIVITY_COUNT
    );
  const reasons: string[] = [];
  let decision: TDecision;
  if (!complete) {
    decision = "revise";
    reasons.push("cost comparison is a dry-run pilot; agent effort is not measured");
  } else if (hoursMultiple > THRESHOLD && spendMultiple > THRESHOLD) {
    decision = "stop";
    reasons.push("both extrapolated multiples exceed 2x the planned budget");
  } else if (hoursMultiple > THRESHOLD || spendMultiple > THRESHOLD) {
    decision = "revise";
    reasons.push("one extrapolated multiple exceeds 2x the planned budget");
  } else {
    decision = "proceed";
  }
  return {
    decision,
    measured_hours: Number(measuredHours.toFixed(6)),
    extrapolated_hours: input.extrapolated_hours,
    measured_spend_usd: input.measured_spend_usd,
    budget_hours: input.budget_hours,
    budget_spend_usd: input.budget_spend_usd,
    hours_multiple: Number(hoursMultiple.toFixed(6)),
    spend_multiple: Number(spendMultiple.toFixed(6)),
    comparison_rule: "both",
    reasons,
    owner: input.owner ?? "owner",
    signed_at: new Date().toISOString(),
  };
}

async function readJson<T>(name: string): Promise<T> {
  const value: T = JSON.parse(await Deno.readTextFile(join(EVIDENCE_DIR, name)));
  return value;
}

async function main(args: readonly string[]): Promise<number> {
  const outputArg = args.find((arg) => arg.startsWith("--output="));
  const output = outputArg === undefined ? EVIDENCE_DIR : resolve(outputArg.slice("--output=".length));
  let record: IPrerequisitesFile;
  let cost: ICostFile;
  let manifest: { content_hash: string };
  let snapshot: { manifest_hash: string };
  let verdicts: IVerdictFile;
  let benchmarks: IBenchmarkFile;
  try {
    [record, cost, manifest, snapshot, verdicts, benchmarks] = await Promise.all([
      readJson<IPrerequisitesFile>("prerequisites.json"),
      readJson<ICostFile>("cost_comparison.json"),
      readJson<{ content_hash: string }>("snapshot_manifest.json"),
      readJson<{ manifest_hash: string }>("snapshot_run.json"),
      readJson<IVerdictFile>("scenario_verdicts.json"),
      readJson<IBenchmarkFile>("benchmarks.json"),
    ]);
  } catch (error) {
    console.error(`❌ evidence read failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const evidence = {
    manifest_hash: manifest.content_hash,
    snapshot_manifest_hash: snapshot.manifest_hash,
    verdict_count: verdicts.verdicts.length,
    benchmark_modes: benchmarks.modes.length,
    cost_packages: cost.packages.length,
  };
  const errors = evidenceErrors(evidence);
  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    return 1;
  }
  const measuredSpend = cost.packages.reduce((sum, entry) => sum + entry.spend_usd, 0);
  const decision = decide({
    budget_hours: record.budget.hours,
    budget_spend_usd: record.budget.spend_usd,
    measured_spend_usd: Number(measuredSpend.toFixed(6)),
    extrapolated_hours: cost.extrapolation.high,
    packages: cost.packages,
    owner: record.owner,
  });
  const base = join(output, "d24_decision");
  await Deno.mkdir(output, { recursive: true });
  await Deno.writeTextFile(`${base}.json`, `${JSON.stringify(decision, null, 2)}\n`);
  const lines = [
    `# D24 forecast: ${decision.decision}`,
    "",
    `- Measured hours: ${decision.measured_hours} of ${decision.budget_hours} (raw pilot)`,
    `- Extrapolated hours: ${decision.extrapolated_hours} (${decision.hours_multiple}x budget)`,
    `- Measured spend: $${decision.measured_spend_usd} of $${decision.budget_spend_usd} (${decision.spend_multiple}x)`,
    `- Rule: ${decision.comparison_rule} extrapolated multiples must be at most 2x`,
    `- Owner: ${decision.owner}`,
    `- Reasons: ${decision.reasons.length === 0 ? "none" : decision.reasons.join("; ")}`,
    `- Owner action: ${decision.decision === "proceed" ? "none" : "review scope and schedule"}`,
  ];
  await Deno.writeTextFile(`${base}.md`, `${lines.join("\n")}\n`);
  console.log(`✅ D24 ${decision.decision} (${decision.hours_multiple}x hours, ${decision.spend_multiple}x spend)`);
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
