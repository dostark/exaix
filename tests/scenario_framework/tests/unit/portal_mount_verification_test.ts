/**
 * @module PortalMountVerificationTest
 * @path tests/scenario_framework/tests/unit/portal_mount_verification_test.ts
 * @related-files ["tests/scenario_framework/schema/step_schema.ts", "tests/scenario_framework/runner/synthetic_runner.ts"]
 * @architectural-layer Test
 * @description Verifies a scenario portal mount carries a verification block into the
 *   sandbox config, and that an invalid block fails scenario load.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas";
import { PortalMountSchema } from "../../schema/step_schema.ts";
import { verificationToml } from "../../runner/synthetic_runner.ts";

const BASE_CONFIG = `[system]
root = "."

[[portals]]
alias = "demo"
target_path = "/tmp/demo"
`;

Deno.test("[scenario-schema] a portal mount carries verification into the sandbox config", () => {
  const mount = PortalMountSchema.parse({
    alias: "demo",
    source_path: "fixtures/demo",
    verification: { checks: [{ kind: "deno_task", task: "test" }] },
  });
  assertEquals(mount.verification?.checks[0].task, "test");

  const updated = BASE_CONFIG + verificationToml(mount.verification!);
  const config = ConfigSchema.parse(parseToml(updated));
  const portal = config.portals.find((p) => p.alias === "demo");
  assertEquals(portal?.verification?.checks.length, 1);
  assertEquals(portal?.verification?.checks[0].task, "test");
});

Deno.test("[scenario-schema] an invalid portal-mount verification block fails scenario load", () => {
  assertThrows(() =>
    PortalMountSchema.parse({
      alias: "demo",
      source_path: "fixtures/demo",
      verification: { checks: [{ kind: "deno_task", task: "test", path: "/etc" }] },
    })
  );
});
