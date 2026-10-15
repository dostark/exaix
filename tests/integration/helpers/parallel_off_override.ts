/**
 * @module ParallelOffOverride
 * @path tests/integration/helpers/parallel_off_override.ts
 * @description Records whether a live comparison exercised parallel-off while enforcing every off response.
 * @architectural-layer Integration
 * @related-files [tests/integration/parallel_tool_round_live_test.ts, tests/integration/parallel_off_override_test.ts]
 */
import { assert } from "@std/assert";
import type { JSONValue } from "@exaix/core/types";

export interface IParallelResponseCounts {
  requested: number;
  executed: number;
}

/** Enforce the off policy before recording whether the baseline exercised its override. */
export async function assertAndRecordParallelOffOverride(
  model: string,
  provider: string,
  autoResponses: IParallelResponseCounts[],
  offResponses: IParallelResponseCounts[],
  save: (label: string, record: JSONValue) => Promise<void>,
): Promise<void> {
  assert(autoResponses.length > 0, "the auto run produced no model responses");
  assert(offResponses.length > 0, "the off run produced no model responses");
  assert(
    offResponses.every((response) => response.executed <= 1),
    `a response executed more than one call under off: ${JSON.stringify(offResponses)}`,
  );
  const exercised = autoResponses.some((response) => response.requested > 1);
  await save(`parallel-off-override-${model}`, {
    model,
    provider,
    status: exercised ? "exercised" : "override not exercised",
    autoResponses: autoResponses.map(({ requested, executed }) => ({ requested, executed })),
    offResponses: offResponses.map(({ requested, executed }) => ({ requested, executed })),
  });
}
