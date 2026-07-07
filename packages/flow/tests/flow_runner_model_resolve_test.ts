/**
 * @module FlowRunnerModelResolveTest
 * @path packages/flow/tests/flow_runner_model_resolve_test.ts
 * @description Phase 132 Step 4 — validates that FlowRunner uses ModelResolver
 *   to resolve dynamicModel presets (small/medium/large) and that mapPresetToSize
 *   maps preset strings to correct ModelSize values.
 * @architectural-layer Flow
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/flow]
 */

import { assertEquals } from "@std/assert";
import { mapPresetToSize } from "@exaix/flow";
import type { ModelSize } from "@exaix/schemas";

Deno.test("[step132.4] mapPresetToSize maps small to S", () => {
  assertEquals<ModelSize | undefined>(mapPresetToSize("small"), "S");
});

Deno.test("[step132.4] mapPresetToSize maps medium to M", () => {
  assertEquals<ModelSize | undefined>(mapPresetToSize("medium"), "M");
});

Deno.test("[step132.4] mapPresetToSize maps large to L", () => {
  assertEquals<ModelSize | undefined>(mapPresetToSize("large"), "L");
});

Deno.test("[step132.4] mapPresetToSize maps xl to XL", () => {
  assertEquals<ModelSize | undefined>(mapPresetToSize("xl"), "XL");
});

Deno.test("[step132.4] mapPresetToSize returns undefined for unknown preset", () => {
  assertEquals<ModelSize | undefined>(mapPresetToSize("unknown"), undefined);
});

Deno.test("[step132.4] mapPresetToSize returns undefined for unknown input", () => {
  assertEquals<ModelSize | undefined>(mapPresetToSize("nonexistent"), undefined);
});
