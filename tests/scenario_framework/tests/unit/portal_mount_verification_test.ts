/**
 * @module PortalMountVerificationTest
 * @path tests/scenario_framework/tests/unit/portal_mount_verification_test.ts
 * @related-files ["tests/scenario_framework/schema/step_schema.ts", "tests/scenario_framework/runner/synthetic_runner.ts"]
 * @architectural-layer Test
 * @description Verifies a scenario portal mount carries a verification block into the
 *   sandbox config, and that an invalid block fails scenario load.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema, isDenoTaskCheck } from "@exaix/schemas";
import { PortalMountSchema } from "../../schema/step_schema.ts";
import { verificationToml } from "../../runner/synthetic_runner.ts";

const BASE_CONFIG = await Deno.readTextFile(
  new URL("../../fixtures/configs/portal-mount-verification-base.toml", import.meta.url),
);

Deno.test("[scenario-schema] a portal mount carries verification into the sandbox config", () => {
  const mount = PortalMountSchema.parse({
    alias: "demo",
    source_path: "fixtures/demo",
    verification: { checks: [{ kind: "deno_task", task: "test" }] },
  });
  const mountCheck = mount.verification?.checks[0];
  assert(mountCheck !== undefined && isDenoTaskCheck(mountCheck));
  assertEquals(mountCheck.task, "test");

  const updated = BASE_CONFIG + verificationToml(mount.verification!);
  const config = ConfigSchema.parse(parseToml(updated));
  const portal = config.portals.find((p) => p.alias === "demo");
  assertEquals(portal?.verification?.checks.length, 1);
  const portalCheck = portal?.verification?.checks[0];
  assert(portalCheck !== undefined && isDenoTaskCheck(portalCheck));
  assertEquals(portalCheck.task, "test");
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

Deno.test("[scenario-schema] a mixed-kind verification block round-trips through the serializer", () => {
  const mount = PortalMountSchema.parse({
    alias: "demo",
    source_path: "fixtures/demo",
    verification: {
      checks: [
        { kind: "deno_task", task: "test" },
        { kind: "unslop", include: ["src/**/*.ts"] },
      ],
    },
  });

  const updated = BASE_CONFIG + verificationToml(mount.verification!);
  const config = ConfigSchema.parse(parseToml(updated));
  const checks = config.portals.find((portal) => portal.alias === "demo")?.verification?.checks ?? [];

  assertEquals(checks.length, 2);
  const denoCheck = checks[0];
  assert(isDenoTaskCheck(denoCheck));
  assertEquals(denoCheck.task, "test");
  const unslopCheck = checks[1];
  assertEquals(unslopCheck.kind, "unslop");
  assertEquals(unslopCheck.kind === "unslop" ? unslopCheck.include : [], ["src/**/*.ts"]);
  assertEquals(unslopCheck.kind === "unslop" ? unslopCheck.packs : [], ["typescript"]);
  assert(!("task" in unslopCheck), "an unslop check serializes no task");
  assert(!("path" in unslopCheck), "an unslop check serializes no path");
});

Deno.test("[scenario-schema] the final pack, catalog and include contract round-trips", () => {
  const mount = PortalMountSchema.parse({
    alias: "demo",
    source_path: "fixtures/demo",
    verification: {
      checks: [{
        kind: "unslop",
        packs: ["deno", "typescript"],
        catalog: "catalogs/portal.json",
        include: ["packages/**/*.ts"],
      }],
    },
  });

  const updated = BASE_CONFIG + verificationToml(mount.verification!);
  const config = ConfigSchema.parse(parseToml(updated));
  const check = config.portals.find((portal) => portal.alias === "demo")?.verification?.checks[0];

  assert(check !== undefined && check.kind === "unslop");
  assertEquals(check.packs, ["typescript", "deno"]);
  assertEquals(check.catalog, "catalogs/portal.json");
  assertEquals(check.include, ["packages/**/*.ts"]);
});
