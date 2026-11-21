#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCostComparison
 * @path scripts/go_port/cost_comparison.ts
 * @description Records the bounded converter-assisted and agent-only cost pilot for two leaf packages.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/cost_comparison.json, exaix-dev-docs/completed/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/cost_comparison.ts
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { goCheckout } from "./checkout.ts";

/** The six activities every arm records. */
export interface IActivityHours {
  readonly tool_development: number;
  readonly ts_preparation: number;
  readonly review: number;
  readonly test_repair: number;
  readonly parity_debugging: number;
  readonly marker_resolution: number;
}

/** The activity names a time log entry can carry. */
type TActivity = keyof IActivityHours;

/** One timestamped activity entry. */
export interface IActivityLogEntry {
  readonly activity: TActivity;
  readonly start: string;
  readonly end: string;
}

/** The two cost arms. */
export type TArm = "converter-assisted" | "agent-only";

/** The two pilot extents. */
export type TExtent = "dry-run" | "conversion";

/** One measured arm for one package. */
export interface IPackageCost {
  readonly package: string;
  readonly arm: TArm;
  readonly extent: TExtent;
  readonly hours: IActivityHours;
  readonly time_log: readonly IActivityLogEntry[];
  readonly spend_usd: number;
  readonly total: number;
  readonly hazards: readonly string[];
  readonly construct_family: string;
}

/** The cost comparison evidence. */
export interface ICostComparison {
  readonly selection: { readonly criteria: string; readonly packages: readonly string[] };
  readonly packages: readonly IPackageCost[];
  readonly extrapolation: {
    readonly low: number;
    readonly high: number;
    readonly unit: "agent-hours";
    readonly basis: string;
  };
}

interface ICostInput {
  readonly selection?: { readonly criteria?: string; readonly packages?: readonly string[] };
  readonly packages?: readonly {
    readonly package?: string;
    readonly arm?: string;
    readonly extent?: string;
    readonly hours?: Partial<IActivityHours>;
    readonly time_log?: readonly { readonly activity?: string; readonly start?: string; readonly end?: string }[];
    readonly spend_usd?: number;
    readonly total?: number;
    readonly hazards?: readonly string[];
    readonly construct_family?: string;
  }[];
  readonly extrapolation?: {
    readonly low?: number;
    readonly high?: number;
    readonly unit?: string;
    readonly basis?: string;
  };
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));

const PACKAGES = ["packages/shared", "packages/ai-google"] as const;
const FAMILY: Record<string, string> = { "packages/shared": "utility", "packages/ai-google": "provider" };
const ACTIVITIES: readonly TActivity[] = [
  "tool_development",
  "ts_preparation",
  "review",
  "test_repair",
  "parity_debugging",
  "marker_resolution",
];

function isTimestamp(value: string): boolean {
  return value !== "" && !Number.isNaN(Date.parse(value));
}

/** Validates a time log: every activity once, ordered, with a positive duration. */
function timeLogErrors(log: readonly { activity?: string; start?: string; end?: string }[]): string[] {
  const errors: string[] = [];
  if (log.length !== ACTIVITIES.length) errors.push("time_log: one entry per activity");
  const seen = new Set<string>();
  for (const entry of log) {
    if (typeof entry.activity !== "string" || !ACTIVITIES.includes(entry.activity as TActivity)) {
      errors.push("time_log.activity");
      continue;
    }
    if (seen.has(entry.activity)) errors.push(`time_log.${entry.activity}: duplicate`);
    seen.add(entry.activity);
    const start = entry.start;
    const end = entry.end;
    if (typeof start !== "string" || !isTimestamp(start)) errors.push("time_log.start");
    if (typeof end !== "string" || !isTimestamp(end)) errors.push("time_log.end");
    if (
      typeof start === "string" && typeof end === "string" && isTimestamp(start) && isTimestamp(end) &&
      Date.parse(end) <= Date.parse(start)
    ) {
      errors.push("time_log: end must follow start");
    }
  }
  return errors;
}

/** Validates the evidence, or throws one message per problem. */
export function validateCostComparison(raw: ICostInput): string[] {
  const errors: string[] = [];
  if (raw.selection?.criteria === undefined || raw.selection.criteria === "") errors.push("selection.criteria");
  if (!Array.isArray(raw.selection?.packages) || raw.selection.packages.length === 0) errors.push("selection.packages");
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) errors.push("packages");
  const arms = new Set<string>();
  for (const entry of raw.packages ?? []) {
    if (entry.arm !== "converter-assisted" && entry.arm !== "agent-only") errors.push("packages.arm");
    else arms.add(entry.arm);
    const extent = entry.extent;
    if (extent !== "dry-run" && extent !== "conversion") errors.push("packages.extent");
    for (const activity of ACTIVITIES) {
      if (typeof entry.hours?.[activity] !== "number") errors.push(`packages.hours.${activity}`);
      else if (extent === "conversion" && entry.hours[activity] <= 0) errors.push(`packages.hours.${activity}`);
    }
    if (typeof entry.spend_usd !== "number" || entry.spend_usd < 0) errors.push("packages.spend_usd");
    else if (extent === "conversion" && entry.spend_usd <= 0) errors.push("packages.spend_usd");
    if (!Array.isArray(entry.time_log)) errors.push("packages.time_log");
    else if (extent === "conversion") errors.push(...timeLogErrors(entry.time_log));
    if (typeof entry.total !== "number" || entry.total <= 0) errors.push("packages.total");
    if (!Array.isArray(entry.hazards) || entry.hazards.some((hazard) => typeof hazard !== "string")) {
      errors.push("packages.hazards");
    }
    if (typeof entry.construct_family !== "string" || entry.construct_family === "") {
      errors.push("packages.construct_family");
    }
  }
  if (arms.size !== 2) errors.push("packages.arm: both arms are required");
  const low = raw.extrapolation?.low;
  const high = raw.extrapolation?.high;
  if (typeof low !== "number" || typeof high !== "number" || low > high) errors.push("extrapolation");
  if (raw.extrapolation?.unit !== "agent-hours") errors.push("extrapolation.unit");
  if (raw.extrapolation?.basis === undefined || raw.extrapolation.basis === "") errors.push("extrapolation.basis");
  if (errors.length > 0) throw new Error(`cost comparison: ${errors.join("; ")}`);
  return [];
}

/** Extrapolates the measured pilot to the planned budget with a low/high range. */
function extrapolate(packages: readonly IPackageCost[]): ICostComparison["extrapolation"] {
  const measured = packages.reduce((sum, entry) => sum + entry.total, 0);
  return {
    low: Number(measured.toFixed(6)),
    high: Number((measured * 2).toFixed(6)),
    unit: "agent-hours",
    basis: "tool-only dry-run pilot; agent effort is not measured",
  };
}

async function measure(packagePath: string, arm: TArm, exaport: string): Promise<IPackageCost> {
  const start = performance.now();
  const args = arm === "converter-assisted"
    ? [
      "run",
      "-A",
      exaport,
      `--root=${join(REPO_ROOT, packagePath)}`,
      "--format=json",
      "--convert",
      "--dry-run",
      `--package=${packagePath}`,
    ]
    : ["run", "-A", exaport, `--root=${join(REPO_ROOT, packagePath)}`, "--format=json"];
  const result = await new Deno.Command("deno", { args, cwd: dirname(exaport), stdout: "piped", stderr: "piped" })
    .output();
  if (!result.success) throw new Error(`exaport ${arm} failed on ${packagePath}`);
  const seconds = (performance.now() - start) / 1000;
  const parsed = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    findings?: readonly { rule?: string }[];
  };
  const hazards = [...new Set((parsed.findings ?? []).map((finding) => String(finding.rule ?? "unknown")))].sort();
  const hours: IActivityHours = {
    tool_development: 0,
    ts_preparation: Number((seconds / 3600).toFixed(6)),
    review: 0,
    test_repair: 0,
    parity_debugging: 0,
    marker_resolution: 0,
  };
  return {
    package: packagePath,
    arm,
    extent: "dry-run",
    hours,
    time_log: [],
    spend_usd: 0,
    total: hours.ts_preparation,
    hazards,
    construct_family: FAMILY[packagePath] ?? "unknown",
  };
}

async function main(): Promise<number> {
  const checkout = await goCheckout(REPO_ROOT, true);
  if (!checkout) throw new Error("Missing Go checkout");
  const exaport = join(checkout, "tools", "exaport", "src", "main.ts");
  const packages: IPackageCost[] = [];
  for (const packagePath of PACKAGES) {
    packages.push(await measure(packagePath, "converter-assisted", exaport));
    packages.push(await measure(packagePath, "agent-only", exaport));
  }
  const document: ICostComparison = {
    selection: { criteria: "small leaf package with existing tests and no native dependency", packages: [...PACKAGES] },
    packages,
    extrapolation: extrapolate(packages),
  };
  try {
    validateCostComparison(document);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const path = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "cost_comparison.json");
  await Deno.writeTextFile(path, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`✅ wrote ${path}`);
  return 0;
}

if (import.meta.main) Deno.exit(await main());
