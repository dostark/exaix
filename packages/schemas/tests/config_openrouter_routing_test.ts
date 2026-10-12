/**
 * @module ConfigOpenRouterRoutingTest
 * @path packages/schemas/tests/config_openrouter_routing_test.ts
 * @description Verifies the ai_openrouter.routing.provider block accepts require_parameters, allow_fallbacks
 * and quantizations, rejects bad values, and still parses configs that omit the new fields.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/config.ts]
 */
import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { ConfigSchema, OPENROUTER_QUANTIZATIONS } from "@exaix/schemas";

function parseProvider(provider: Record<string, JSONValue>) {
  return ConfigSchema.safeParse({ system: { root: "/tmp/x" }, ai_openrouter: { routing: { provider } } });
}

Deno.test("a config without the new routing fields still parses to an empty provider block", () => {
  const parsed = parseProvider({});
  assertEquals(parsed.success, true);
  assertEquals(parsed.success && parsed.data.ai_openrouter?.routing?.provider, {});
  assertEquals(ConfigSchema.safeParse({ system: { root: "/tmp/x" } }).success, true);
});

Deno.test("require_parameters and allow_fallbacks keep their boolean values", () => {
  const parsed = parseProvider({ require_parameters: false, allow_fallbacks: true });
  assertEquals(parsed.success && parsed.data.ai_openrouter?.routing?.provider?.require_parameters, false);
  assertEquals(parsed.success && parsed.data.ai_openrouter?.routing?.provider?.allow_fallbacks, true);
});

Deno.test("require_parameters and allow_fallbacks accept booleans only", () => {
  assertEquals(parseProvider({ require_parameters: "yes" }).success, false);
  assertEquals(parseProvider({ allow_fallbacks: 1 }).success, false);
});

Deno.test("quantizations accept every documented value and reject an unknown one", () => {
  const all = parseProvider({ quantizations: [...OPENROUTER_QUANTIZATIONS] });
  assertEquals(all.success && all.data.ai_openrouter?.routing?.provider?.quantizations, [...OPENROUTER_QUANTIZATIONS]);
  assertEquals(parseProvider({ quantizations: ["fp7"] }).success, false);
});
