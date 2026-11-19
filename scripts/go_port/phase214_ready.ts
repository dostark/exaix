#!/usr/bin/env -S deno run -A
/**
 * @module GoPortPhase214Ready
 * @path scripts/go_port/phase214_ready.ts
 * @description Validates that the owner prerequisites and evidence make Phase 214 ready under D26.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/d24_decision.json, exaix-dev-docs/planning/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/phase214_ready.ts [--online]
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";
import type { ID24Decision } from "./d24_decision.ts";

/** The readiness inputs. */
export interface IReadinessInput {
  readonly decision: ID24Decision;
  readonly parent_protected: boolean;
  readonly team_exception: boolean;
  readonly ci_approved: boolean;
  readonly evidence: readonly string[];
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));

/** Returns every reason the next phase is not ready. D24 is a forecast, not a gate. */
export function readinessErrors(input: IReadinessInput): string[] {
  const errors: string[] = [];
  if (!input.parent_protected) errors.push("parent go-port protection is not live");
  if (!input.team_exception) errors.push("exaix-team protection exception is missing");
  if (!input.ci_approved) errors.push("CI trigger approval is missing");
  for (const evidence of input.evidence) {
    if (evidence.trim() === "") errors.push("evidence path is empty");
  }
  return errors;
}

async function main(args: readonly string[]): Promise<number> {
  const decision = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "d24_decision.json")),
  ) as ID24Decision;
  const prerequisites = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "prerequisites.json")),
  ) as {
    protection: { parent: { attestation: string }; team: { attestation: string } };
    ci_approval: { approved: boolean };
  };
  let parentProtected = prerequisites.protection.parent.attestation === "attested";
  if (args.includes("--online")) {
    const result = await new Deno.Command("gh", {
      args: ["api", "repos/dostark/exaix/branches/go-port/protection"],
      stdout: "piped",
      stderr: "null",
    }).output();
    parentProtected = result.success;
  }
  const evidence = [
    "snapshot_manifest.json",
    "snapshot_run.json",
    "scenario_verdicts.json",
    "benchmarks.json",
    "cost_comparison.json",
  ].map((name) => join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", name));
  const errors = readinessErrors({
    decision,
    parent_protected: parentProtected,
    team_exception: prerequisites.protection.team.attestation === "owner-exception",
    ci_approved: prerequisites.ci_approval.approved,
    evidence,
  });
  for (const file of evidence) {
    if (!(await Deno.stat(file).then(() => true).catch(() => false))) errors.push(`missing evidence ${file}`);
  }
  const result = { ready: errors.length === 0, decision: decision.decision, d26: "committed", errors };
  await Deno.writeTextFile(
    join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "phase214_ready.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    return 1;
  }
  console.log(`✅ Phase 214 is ready (D26 committed; D24 forecast: ${decision.decision})`);
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
