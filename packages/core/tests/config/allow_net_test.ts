/**
 * @module AllowNetTest
 * @path packages/core/tests/config/allow_net_test.ts
 * @description Phase 121 Step 2 — tests for the allow_net config field.
 *   Verifies parsing of [system].allow_net as an optional string array.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas/config.ts";

Deno.test("[allow_net] parses allow_net with host entries", () => {
  const config = ConfigSchema.parse({
    system: { allow_net: ["api.anthropic.com", "api.openai.com"] },
    paths: {},
  });
  assertEquals(config.system.allow_net, ["api.anthropic.com", "api.openai.com"]);
});

Deno.test("[allow_net] allow_net is undefined when omitted", () => {
  const config = ConfigSchema.parse({ system: {}, paths: {} });
  assertEquals(config.system.allow_net, undefined);
});

Deno.test("[allow_net] allow_net accepts empty array", () => {
  const config = ConfigSchema.parse({
    system: { allow_net: [] },
    paths: {},
  });
  assertEquals(config.system.allow_net, []);
});

Deno.test("[allow_net][security] rejects entries with invalid host format", () => {
  assertThrows(
    () =>
      ConfigSchema.parse({
        system: { allow_net: ["; rm -rf /"] },
        paths: {},
      }),
    "must reject shell injection attempts in host field",
  );
});

Deno.test("[allow_net][security] accepts valid host:port format", () => {
  const config = ConfigSchema.parse({
    system: { allow_net: ["valid-host.com:443", "192.168.1.1:8080"] },
    paths: {},
  });
  assertEquals(config.system.allow_net, ["valid-host.com:443", "192.168.1.1:8080"]);
});
