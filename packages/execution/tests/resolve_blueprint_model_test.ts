/**
 * @module ResolveBlueprintModelTest
 * @path packages/execution/tests/resolve_blueprint_model_test.ts
 * @description Phase 131 Step 6 (GAP-3 wiring) — the executor's model-id
 *   resolution. Verifies resolveBlueprintModelId returns the explicit canonical
 *   model when present (precedence), combines a legacy provider+model, and
 *   otherwise resolves declarative preferences through a ProviderSelector into a
 *   concrete `provider:model` string. This is the production seam resolveModelId
 *   delegates to.
 * @architectural-layer Execution
 * @dependencies [@std/assert]
 * @related-files [packages/execution/src/agent_executor.ts, packages/ai/src/resolve_identity_model.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { resolveBlueprintModelId } from "@exaix/execution";
import type { ISelectorLike } from "@exaix/ai";

/** Minimal structural selector that returns a fixed provider name. */
function fakeSelector(name: string): ISelectorLike {
  return { selectProvider: () => Promise.resolve(name) } as ISelectorLike;
}

function blueprint(over: Partial<{ model: string; provider: string; model_size: "S" | "M" | "L" | "XL" }>) {
  return {
    name: "x",
    model: over.model ?? "",
    provider: over.provider ?? "",
    capabilities: [],
    systemPrompt: "p",
    model_size: over.model_size,
  };
}

Deno.test("[step6] explicit canonical model takes precedence (no selector call)", async () => {
  const id = await resolveBlueprintModelId(blueprint({ model: "anthropic:claude-sonnet-4-20250514" }));
  assertEquals(id, "anthropic:claude-sonnet-4-20250514");
});

Deno.test("[step6] legacy provider+model combine without a selector", async () => {
  const id = await resolveBlueprintModelId(blueprint({ model: "gpt-4o", provider: "openai" }));
  assertEquals(id, "openai:gpt-4o");
});

Deno.test("[step6][GAP-3] prefs-only blueprint resolves to a concrete provider:model via the selector", async () => {
  const id = await resolveBlueprintModelId(blueprint({ model_size: "L" }), fakeSelector("anthropic"));
  assert(id.startsWith("anthropic:"), `expected a concrete anthropic model, got ${id}`);
  assert(id.split(":")[1].length > 0, "model half must be concrete");
});
