#!/usr/bin/env -S deno run -A
/**
 * @module GoPortD24Decision
 * @path scripts/go_port/d24_decision.ts
 * @description Computes and records the D24 proceed/revise/stop decision from the Phase 245 evidence.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/cost_comparison.json, exaix-dev-docs/planning/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/d24_decision.ts
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

/** One cost entry the decision reads. */
export interface ID24Package {
  readonly package: string;
  readonly arm: string;
  readonly extent: string;
  readonly hours: { readonly review: number; readonly [activity: string]: number };
  readonly total: number;
  readonly hazards: readonly string[];
  readonly construct_family: string;
}

/** The decision input. */
export interface ID24Input {
  readonly budget_hours: number;
  readonly budget_spend_usd: number;
  readonly measured_spend_usd: number;
  readonly packages: readonly ID24Package[];
  readonly owner?: string;
}

/** The three decision values. */
type TDecision = "proceed" | "revise" | "stop";

/** The recorded decision. */
export interface ID24Decision {
  readonly decision: TDecision;
  readonly measured_hours: number;
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

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const THRESHOLD = 2;

/** Computes the D24 decision. Incomplete measurements cannot proceed. */
export function decide(input: ID24Input): ID24Decision {
  if (input.packages.length === 0) throw new Error("packages: at least one cost entry is required");
  if (input.budget_hours <= 0) throw new Error("budget_hours: must be positive");
  if (input.budget_spend_usd <= 0) throw new Error("budget_spend_usd: must be positive");
  const measuredHours = input.packages.reduce((sum, entry) => sum + entry.total, 0);
  const hoursMultiple = measuredHours / input.budget_hours;
  const spendMultiple = input.measured_spend_usd / input.budget_spend_usd;
  const complete = input.packages.every((entry) =>
    entry.extent === "conversion" && entry.total > 0 && entry.hours.review > 0
  );
  const reasons: string[] = [];
  let decision: TDecision;
  if (!complete) {
    decision = "revise";
    reasons.push("cost comparison is a dry-run pilot; agent effort is not measured");
  } else if (hoursMultiple > THRESHOLD && spendMultiple > THRESHOLD) {
    decision = "stop";
    reasons.push("both measured multiples exceed 2x the planned budget");
  } else if (hoursMultiple > THRESHOLD || spendMultiple > THRESHOLD) {
    decision = "revise";
    reasons.push("one measured multiple exceeds 2x the planned budget");
  } else {
    decision = "proceed";
  }
  return {
    decision,
    measured_hours: measuredHours,
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

async function main(): Promise<number> {
  const [prerequisites, cost] = await Promise.all([
    Deno.readTextFile(join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "prerequisites.json")),
    Deno.readTextFile(join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "cost_comparison.json")),
  ]);
  const record = JSON.parse(prerequisites) as {
    owner: string;
    budget: { hours: number; spend_usd: number };
  };
  const costs = JSON.parse(cost) as { packages: readonly ID24Package[] };
  const decision = decide({
    budget_hours: record.budget.hours,
    budget_spend_usd: record.budget.spend_usd,
    measured_spend_usd: 0,
    packages: costs.packages,
    owner: record.owner,
  });
  const base = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "d24_decision");
  await Deno.writeTextFile(`${base}.json`, `${JSON.stringify(decision, null, 2)}\n`);
  const lines = [
    `# D24 decision: ${decision.decision}`,
    "",
    `- Measured hours: ${decision.measured_hours} of ${decision.budget_hours} (${decision.hours_multiple}x)`,
    `- Measured spend: $${decision.measured_spend_usd} of $${decision.budget_spend_usd} (${decision.spend_multiple}x)`,
    `- Rule: ${decision.comparison_rule} multiples must be at most 2x`,
    `- Owner: ${decision.owner}`,
    `- Reasons: ${decision.reasons.length === 0 ? "none" : decision.reasons.join("; ")}`,
  ];
  await Deno.writeTextFile(`${base}.md`, `${lines.join("\n")}\n`);
  console.log(`✅ D24 ${decision.decision} (${decision.hours_multiple}x hours, ${decision.spend_multiple}x spend)`);
  return 0;
}

if (import.meta.main) Deno.exit(await main());
