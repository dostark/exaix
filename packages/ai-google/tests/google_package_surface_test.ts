/**
 * @module GooglePackageSurfaceTest
 * @path packages/ai-google/tests/google_package_surface_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies the public @exaix/ai-google package surface.
 */

import { assertEquals, assertExists } from "@std/assert";
import { DEFAULT_GOOGLE_MODEL, GoogleProvider, GoogleProviderFactory } from "../mod.ts";

Deno.test("@exaix/ai-google exports provider and factory", () => {
  assertExists(GoogleProvider);
  assertExists(GoogleProviderFactory);
});

Deno.test("GoogleProvider constructs with defaults from package surface", () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });

  assertEquals(typeof provider.id, "string");
  assertEquals(provider.id, `google-${DEFAULT_GOOGLE_MODEL}`);
});
