#!/usr/bin/env -S deno run -A
/**
 * @module GoPortExaportConvert
 * @path scripts/go_port/exaport/src/convert.ts
 * @description Builds a dry-run conversion plan from readiness findings.
 * Usage: imported by the exaport entry point.
 * @architectural-layer Tooling
 * @dependencies [typescript]
 */
import type { IFinding } from "./rules/deno_api.ts";

/** A dry-run conversion plan. It writes nothing. */
export interface IConversionPlan {
  readonly package: string;
  readonly dry_run: true;
  readonly files: number;
  readonly construct_families: readonly string[];
  readonly hazards: readonly string[];
  readonly findings: readonly IFinding[];
}

/** Builds a conversion plan from findings and a file count. */
export function conversionPlan(
  packagePath: string,
  files: number,
  findings: readonly IFinding[],
): IConversionPlan {
  return {
    package: packagePath,
    dry_run: true,
    files,
    construct_families: [...new Set(findings.map((finding) => finding.hazard))]
      .sort(),
    hazards: findings.map((finding) => `${finding.rule}:${finding.file}:${finding.line}`),
    findings,
  };
}
