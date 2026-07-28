/**
 * @module FlowRunnerAggregateInputTest
 * @path packages/flow/tests/flow_runner_aggregate_input_test.ts
 * @description Phase 142 Step 13 — a step with `source: aggregate` and no explicit `from`
 *   draws from its `dependsOn` steps.
 *
 *   The runner required the consumed steps to be restated in `from` even though `dependsOn`
 *   already names them, and threw `has source "aggregate" but no "from" steps specified`
 *   otherwise. Three of the four flows using aggregate omitted it — `code-review`'s
 *   `final-report`, `consensus-review`'s `consensus` and `documentation`'s
 *   `compile-documentation` — so each failed at its final step, the flow aggregated nothing,
 *   and the request died on "Invalid JSON: Unexpected end of JSON input" with nothing naming
 *   the cause. Restating a dependency list in a second field is drift waiting to happen, and
 *   it happened in three flows out of four.
 * @architectural-layer Unit
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { resolveAggregateSources } from "@exaix/flow";

Deno.test("[aggregate-input] falls back to dependsOn when `from` is omitted", () => {
  assertEquals(resolveAggregateSources({ input: {}, dependsOn: ["alpha", "beta"] }), ["alpha", "beta"]);
});

Deno.test("[aggregate-input] an explicit `from` wins over dependsOn", () => {
  // A step may depend on more than it consumes; the explicit list is the narrower intent.
  assertEquals(resolveAggregateSources({ input: { from: ["alpha"] }, dependsOn: ["alpha", "beta"] }), ["alpha"]);
});

Deno.test("[aggregate-input] an empty `from` falls back rather than resolving to nothing", () => {
  assertEquals(resolveAggregateSources({ input: { from: [] }, dependsOn: ["alpha"] }), ["alpha"]);
});

Deno.test("[aggregate-input] neither specified resolves to empty, which the caller treats as an error", () => {
  // Returning empty rather than throwing keeps this pure; silently aggregating nothing is the
  // failure this whole step has been unwinding, so the caller must still refuse it.
  assertEquals(resolveAggregateSources({ input: {} }), []);
});
