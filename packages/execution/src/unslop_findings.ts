/**
 * @module UnslopFindings
 * @path packages/execution/src/unslop_findings.ts
 * @description Deterministic full-position diagnostic identity and bounded prefix collection.
 * @architectural-layer Services
 * @dependencies []
 * @related-files [packages/execution/src/unslop_check_runner.ts, packages/execution/tests/unslop_check_runner_test.ts]
 */

import type { IUnslopFinding } from "./unslop_check_types.ts";

/** One bounded aggregate. Batches have disjoint validated file sets. */
export interface IUnslopCollectedFindings {
  readonly findings: IUnslopFinding[];
  readonly total: number;
  readonly hostExitCodes: number[];
}

/** Orders findings before any safe display projection. */
export function compareUnslopFindings(left: IUnslopFinding, right: IUnslopFinding): number {
  return left.file.localeCompare(right.file) || left.start_line - right.start_line ||
    left.start_column - right.start_column || left.rule.localeCompare(right.rule) ||
    left.end_line - right.end_line || left.end_column - right.end_column;
}

/** Deduplicates a single byte-bounded host batch by complete source position identity. */
export function uniqueUnslopBatch(findings: readonly IUnslopFinding[]): IUnslopFinding[] {
  const unique = new Map<string, IUnslopFinding>();
  for (const finding of findings) {
    const key = JSON.stringify([
      finding.file,
      finding.start_line,
      finding.start_column,
      finding.end_line,
      finding.end_column,
      finding.rule,
    ]);
    unique.set(key, finding);
  }
  return [...unique.values()].sort(compareUnslopFindings);
}
