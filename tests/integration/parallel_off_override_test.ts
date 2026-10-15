/**
 * @module ParallelOffOverrideTest
 * @path tests/integration/parallel_off_override_test.ts
 * @description Verifies honest override evidence and strict off-run enforcement without paid requests.
 * @architectural-layer Integration
 * @related-files [tests/integration/helpers/parallel_off_override.ts, tests/integration/parallel_tool_round_live_test.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { JSONValue } from "@exaix/core/types";
import { assertAndRecordParallelOffOverride } from "./helpers/parallel_off_override.ts";

const MODEL = "anthropic/model-fixture";
const PROVIDER = "openrouter";
interface ISavedEvidence {
  label: string;
  record: JSONValue;
}

Deno.test("[parallel-off] a baseline that never batches records override not exercised with its model", async () => {
  const saved: ISavedEvidence[] = [];
  await assertAndRecordParallelOffOverride(
    MODEL,
    PROVIDER,
    [{ requested: 1, executed: 1 }, { requested: 1, executed: 1 }],
    [{ requested: 1, executed: 1 }],
    (label, record) => {
      saved.push({ label, record });
      return Promise.resolve();
    },
  );
  assertEquals(saved, [{
    label: `parallel-off-override-${MODEL}`,
    record: {
      model: MODEL,
      provider: PROVIDER,
      status: "override not exercised",
      autoResponses: [{ requested: 1, executed: 1 }, { requested: 1, executed: 1 }],
      offResponses: [{ requested: 1, executed: 1 }],
    },
  }]);
});

Deno.test("[parallel-off] an exercised comparison records the baseline batch and bounded off responses", async () => {
  const saved: ISavedEvidence[] = [];
  await assertAndRecordParallelOffOverride(MODEL, PROVIDER, [{ requested: 3, executed: 3 }], [{
    requested: 3,
    executed: 1,
  }], (label, record) => {
    saved.push({ label, record });
    return Promise.resolve();
  });
  assertEquals(saved[0].record, {
    model: MODEL,
    provider: PROVIDER,
    status: "exercised",
    autoResponses: [{ requested: 3, executed: 3 }],
    offResponses: [{ requested: 3, executed: 1 }],
  });
});

for (const baselineCount of [1, 3]) {
  Deno.test(`[parallel-off] off violations fail even when the baseline requested ${baselineCount} calls`, async () => {
    let writes = 0;
    await assertRejects(
      () =>
        assertAndRecordParallelOffOverride(MODEL, PROVIDER, [{ requested: baselineCount, executed: baselineCount }], [{
          requested: 2,
          executed: 2,
        }], () => {
          writes++;
          return Promise.resolve();
        }),
      Error,
      "a response executed more than one call under off",
    );
    assertEquals(writes, 0);
  });
}

Deno.test("[parallel-off] an empty off run cannot certify the override", async () => {
  await assertRejects(
    () =>
      assertAndRecordParallelOffOverride(MODEL, PROVIDER, [{ requested: 1, executed: 1 }], [], () => Promise.resolve()),
    Error,
    "the off run produced no model responses",
  );
});

Deno.test("[parallel-off] a failed baseline cannot be classified as an unexercised model override", async () => {
  await assertRejects(
    () =>
      assertAndRecordParallelOffOverride(MODEL, PROVIDER, [], [{ requested: 1, executed: 1 }], () => Promise.resolve()),
    Error,
    "the auto run produced no model responses",
  );
});
