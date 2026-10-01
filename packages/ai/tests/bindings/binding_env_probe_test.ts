/**
 * @module BindingEnvProbeTest
 * @path packages/ai/tests/bindings/binding_env_probe_test.ts
 * @description Covers the production key probe: presence, credential-store fallback and the
 *   in-memory credential version that keys the provider pool.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { createProductionBindingEnvProbe } from "@exaix/ai";

function probeFor(env: Record<string, string>, stored: Record<string, string>) {
  return createProductionBindingEnvProbe(
    { get: (name: string) => env[name] },
    { get: (name: string) => Promise.resolve(stored[name] ?? null) },
  );
}

Deno.test("[probe] keyVersion changes with the credential, is stable otherwise and empty when absent", async () => {
  const one = await probeFor({ KEY: "first" }, {}).keyVersion("KEY");
  const same = await probeFor({ KEY: "first" }, {}).keyVersion("KEY");
  const rotated = await probeFor({ KEY: "second" }, {}).keyVersion("KEY");
  assertEquals(one, same);
  assertNotEquals(one, rotated);
  assertEquals(await probeFor({}, {}).keyVersion("KEY"), "");
});

Deno.test("[probe] a key stored after start counts as present and versions from the store", async () => {
  const stored = await probeFor({}, { KEY: "from-store" });
  assertEquals(await stored.hasKey("KEY"), true);
  assertNotEquals(await stored.keyVersion("KEY"), "");
  assertEquals(await stored.keyVersion("KEY"), await probeFor({}, { KEY: "from-store" }).keyVersion("KEY"));
});

Deno.test("[probe] the credential value never appears in its version", async () => {
  const version = await probeFor({ KEY: "super-secret-value" }, {}).keyVersion("KEY");
  assertEquals(version.includes("super-secret-value"), false);
  assertEquals(/^[a-f0-9]{64}$/.test(version), true);
});
