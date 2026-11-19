#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCostComparison
 * @path scripts/go_port/cost_comparison.ts
 * @description Records the bounded converter-assisted and agent-only cost pilot for two leaf packages.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/cost_comparison.json, exaix-dev-docs/planning/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/cost_comparison.ts
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

/** The six activities every arm records. */
interface IActivityHours {
  readonly tool_development: number;
  readonly ts_preparation: number;
  readonly review: number;
  readonly test_repair: number;
  readonly parity_debugging: number;
  readonly marker_resolution: number;
}

/** The two cost arms. */
type TArm = "converter-assisted" | "agent-only";

/** The pilot extent value. */
type TExtent = "dry-run";

/** One measured arm for one package. */
interface IPackageCost {
  readonly package: string;
  readonly arm: TArm;
  readonly extent: TExtent;
  readonly hours: IActivityHours;
  readonly total: number;
  readonly hazards: readonly string[];
  readonly construct_family: string;
}

/** The cost comparison evidence. */
interface ICostComparison {
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
const EXAPORT = join(dirname(REPO_ROOT), "exaix-go", "tools", "exaport", "src", "main.ts");
const PACKAGES = ["packages/shared", "packages/ai-google"] as const;
const FAMILY: Record<string, string> = { "packages/shared": "utility", "packages/ai-google": "provider" };

/** Validates the evidence, or throws one message per problem. */
export function validateCostComparison(raw: ICostInput): string[] {
  const errors: string[] = [];
  if (raw.selection?.criteria === undefined || raw.selection.criteria === "") errors.push("selection.criteria");
  if (!Array.isArray(raw.selection?.packages) || raw.selection.packages.length === 0) errors.push("selection.packages");
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) errors.push("packages");
  for (const entry of raw.packages ?? []) {
    if (entry.arm !== "converter-assisted" && entry.arm !== "agent-only") errors.push("packages.arm");
    if (entry.extent !== "dry-run") errors.push("packages.extent");
    for (
      const activity of [
        "tool_development",
        "ts_preparation",
        "review",
        "test_repair",
        "parity_debugging",
        "marker_resolution",
      ] as const
    ) {
      if (typeof entry.hours?.[activity] !== "number") errors.push(`packages.hours.${activity}`);
    }
    if (typeof entry.total !== "number" || entry.total <= 0) errors.push("packages.total");
    if (!Array.isArray(entry.hazards) || entry.hazards.some((hazard) => typeof hazard !== "string")) {
      errors.push("packages.hazards");
    }
    if (typeof entry.construct_family !== "string" || entry.construct_family === "") {
      errors.push("packages.construct_family");
    }
  }
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

async function measure(packagePath: string, arm: TArm): Promise<IPackageCost> {
  const start = performance.now();
  const args = arm === "converter-assisted"
    ? [
      "run",
      "-A",
      EXAPORT,
      `--root=${join(REPO_ROOT, packagePath)}`,
      "--format=json",
      "--convert",
      "--dry-run",
      `--package=${packagePath}`,
    ]
    : ["run", "-A", EXAPORT, `--root=${join(REPO_ROOT, packagePath)}`, "--format=json"];
  const result = await new Deno.Command("deno", { args, cwd: dirname(EXAPORT), stdout: "piped", stderr: "piped" })
    .output();
  if (!result.success) throw new Error(`exaport ${arm} failed on ${packagePath}`);
  const seconds = (performance.now() - start) / 1000;
  const parsed = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    findings?: readonly { rule?: string }[];
    dry_run?: boolean;
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
    total: hours.ts_preparation,
    hazards,
    construct_family: FAMILY[packagePath] ?? "unknown",
  };
}

async function main(): Promise<number> {
  const packages: IPackageCost[] = [];
  for (const packagePath of PACKAGES) {
    packages.push(await measure(packagePath, "converter-assisted"));
    packages.push(await measure(packagePath, "agent-only"));
  }
  const document: ICostComparison = {
    selection: { criteria: "small leaf package with existing tests and no native dependency", packages: [...PACKAGES] },
    packages,
    extrapolation: extrapolate(packages),
  };
  validateCostComparison(document);
  const path = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "cost_comparison.json");
  await Deno.writeTextFile(path, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`✅ wrote ${path}`);
  return 0;
}

if (import.meta.main) Deno.exit(await main());
