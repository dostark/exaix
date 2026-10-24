/**
 * @module PortalMountVerificationTest
 * @path tests/scenario_framework/tests/unit/portal_mount_verification_test.ts
 * @related-files ["tests/scenario_framework/schema/step_schema.ts", "tests/scenario_framework/runner/synthetic_runner.ts"]
 * @architectural-layer Test
 * @description Verifies a scenario portal mount carries a verification block into the
 *   sandbox config, and that an invalid block fails scenario load.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { ConfigSchema, isDenoTaskCheck } from "@exaix/schemas";
import { PortalMountSchema } from "../../schema/step_schema.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { stageUnslopAssets, verificationToml } from "../../runner/synthetic_runner.ts";
import { buildUnslopPortalAssets } from "../../../../scripts/build_unslop_portal_bundle.ts";

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

Deno.test("[scenario-schema] unslop_assets defaults off and accepts an explicit flag", async () => {
  const yaml = await Deno.readTextFile(
    new URL("../../scenarios/agent_flows/execution-verification-repair.yaml", import.meta.url),
  );
  const parsed = ScenarioSchema.parse(parseYaml(yaml) as Record<string, unknown>);
  assertEquals(parsed.unslop_assets, false);
  const enabled = ScenarioSchema.parse({ ...parseYaml(yaml) as Record<string, unknown>, unslop_assets: true });
  assertEquals(enabled.unslop_assets, true);
});
Deno.test("[scenario-schema] stageUnslopAssets copies a verified set and rejects a missing one", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "unslop-stage-source-" });
  const workspaceRoot = await Deno.makeTempDir({ prefix: "unslop-stage-workspace-" });
  try {
    await buildUnslopPortalAssets({
      root: new URL("../../../../", import.meta.url).pathname,
      out: join(repoRoot, "lint"),
    });
    await stageUnslopAssets(repoRoot, workspaceRoot);
    assert(await exists(join(workspaceRoot, "lint", "manifest.json")));
    assert(await exists(join(workspaceRoot, "lint", "unslop_engine.js")));

    const emptyRoot = await Deno.makeTempDir({ prefix: "unslop-stage-empty-" });
    try {
      await assertRejects(
        () => stageUnslopAssets(emptyRoot, workspaceRoot),
        Error,
        "unslop assets missing",
      );
    } finally {
      await Deno.remove(emptyRoot, { recursive: true });
    }
  } finally {
    await Deno.remove(repoRoot, { recursive: true }).catch(() => {});
    await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
  }
});
