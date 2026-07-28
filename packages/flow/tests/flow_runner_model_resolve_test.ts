/**
 * @module FlowRunnerModelResolveTest
 * @path packages/flow/tests/flow_runner_model_resolve_test.ts
 * @description Exhaustive mapping table for `mapPresetToSize` — the pure preset→ModelSize lookup
 *   in `packages/flow/src/preset_mapper.ts`.
 *
 *   The filename and the previous header both claimed this file "validates that FlowRunner uses
 *   ModelResolver to resolve dynamicModel presets". It does not, and never did: it imports no
 *   FlowRunner and constructs no runner. That wiring — `flow_runner.ts:826` building an
 *   `IModelIntent` and handing it to `modelResolver.resolve` — is covered by the sibling
 *   `flow_dynamic_model_resolve_test.ts`, which drives a real `FlowRunner.execute` against a
 *   capturing resolver stub. Two files claiming the same coverage is how a gap hides: the sibling
 *   pins only `medium`→M and the unknown fallthrough, so S, L and XL are pinned *only* here.
 *
 *   The six original cases were also five: `"unknown"` and `"nonexistent"` are the same `default`
 *   branch asserted twice.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/flow, @exaix/schemas]
 * @related-files [packages/flow/src/preset_mapper.ts, packages/flow/tests/flow_dynamic_model_resolve_test.ts]
 */

import { assertEquals } from "@std/assert";
import { mapPresetToSize } from "@exaix/flow";
import type { ModelSize } from "@exaix/schemas";

/** Every preset the flow schema accepts, and the ModelSize each must resolve to. */
const PRESET_TABLE: ReadonlyArray<[preset: string, size: ModelSize]> = [
  ["small", "S"],
  ["medium", "M"],
  ["large", "L"],
  ["xl", "XL"],
];

Deno.test("[step132.4] every documented preset maps to its ModelSize", () => {
  for (const [preset, size] of PRESET_TABLE) {
    assertEquals(mapPresetToSize(preset), size, `preset "${preset}" must resolve to ${size}`);
  }
});

Deno.test("[step132.4] an unrecognised preset falls through to undefined, not a default size", () => {
  // undefined is load-bearing: flow_runner.ts:826 passes it as `model_size`, and ModelResolver
  // treats an absent size as "use the configured default" rather than silently picking S.
  assertEquals(mapPresetToSize("nonexistent"), undefined);
  assertEquals(mapPresetToSize(""), undefined);
});

Deno.test("[step132.4] preset matching is case-sensitive and untrimmed", () => {
  // Documents the current contract rather than asserting a wish: flow YAML authors writing
  // "Medium" or " medium" get the default model, not M. If that is ever softened, this fails.
  assertEquals(mapPresetToSize("Medium"), undefined);
  assertEquals(mapPresetToSize(" medium"), undefined);
});
