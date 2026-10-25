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
import { stageLintPolicy, verificationToml, withoutPortalRegions } from "../../runner/synthetic_runner.ts";
import { installLintPolicyForTest } from "@exaix/testing";

Deno.test("[scenario-schema] re-mounting an alias drops its older portal entries and verification blocks", () => {
  const first =
    '\n[[portals]]\nalias = "verify-app"\ntarget_path = "/ws/verify-app"\ncreated = "2026-10-24T00:00:00.000Z"\n';
  const second =
    '\n[[portals]]\nalias = "verify-app"\ntarget_path = "/ws/verify-app"\ncreated = "2026-10-24T00:01:00.000Z"\n' +
    verificationToml({
      checks: [{
        kind: "deno_lint",
        policy: "unslop",
        include: ["**/*.ts"],
        exclude: ["node_modules/**", "vendor/**"],
      }],
      max_repair_attempts: 1,
      check_timeout_ms: 20_000,
      output_max_chars: 4_000,
    });
  const other =
    '\n[[portals]]\nalias = "other-app"\ntarget_path = "/ws/other-app"\ncreated = "2026-10-24T00:02:00.000Z"\n';
  const config = `[system]\nroot = "."\n${first}${second}${other}[skills]\ncontext_budget_chars = 4000\n`;

  const rewritten = withoutPortalRegions(config, "verify-app");
  const parsed = ConfigSchema.parse(parseToml(rewritten));

  // Exactly one surviving portal, and the unrelated alias and top-level table are untouched.
  assertEquals(parsed.portals.map((portal) => portal.alias), ["other-app"]);
  assertEquals(parsed.skills.context_budget_chars, 4000);
  assert(!rewritten.includes("verify-app"), "no stale verify-app entry or verification block may survive");
});

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
        { kind: "deno_lint", include: ["src/**/*.ts"] },
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
  const lintCheck = checks[1];
  assertEquals(lintCheck.kind, "deno_lint");
  assertEquals(lintCheck.kind === "deno_lint" ? lintCheck.include : [], ["src/**/*.ts"]);
  assertEquals(lintCheck.kind === "deno_lint" ? lintCheck.policy : "", "unslop");
  assertEquals(lintCheck.kind === "deno_lint" ? lintCheck.exclude : [], ["node_modules/**", "vendor/**"]);
  assert(!("task" in lintCheck), "a deno_lint check serializes no task");
  assert(!("path" in lintCheck), "a deno_lint check serializes no path");
});

Deno.test("[scenario-schema] the final pack, catalog and include contract round-trips", () => {
  const mount = PortalMountSchema.parse({
    alias: "demo",
    source_path: "fixtures/demo",
    verification: {
      checks: [{
        kind: "deno_lint",
        policy: "other-policy",
        include: ["packages/**/*.ts"],
        exclude: ["dist/**"],
      }],
    },
  });

  const updated = BASE_CONFIG + verificationToml(mount.verification!);
  const config = ConfigSchema.parse(parseToml(updated));
  const check = config.portals.find((portal) => portal.alias === "demo")?.verification?.checks[0];

  assert(check !== undefined && check.kind === "deno_lint");
  assertEquals(check.policy, "other-policy");
  assertEquals(check.include, ["packages/**/*.ts"]);
  assertEquals(check.exclude, ["dist/**"]);
});

Deno.test("[scenario-schema] lint_policy defaults off and accepts an explicit flag", async () => {
  const yaml = await Deno.readTextFile(
    new URL("../../scenarios/agent_flows/execution-verification-repair.yaml", import.meta.url),
  );
  const parsed = ScenarioSchema.parse(parseYaml(yaml) as Record<string, unknown>);
  assertEquals(parsed.lint_policy, false);
  const enabled = ScenarioSchema.parse({ ...parseYaml(yaml) as Record<string, unknown>, lint_policy: true });
  assertEquals(enabled.lint_policy, true);
});
Deno.test("[scenario-schema] stageLintPolicy copies a verified directory and rejects a missing one", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "lint-stage-source-" });
  const workspaceRoot = await Deno.makeTempDir({ prefix: "lint-stage-workspace-" });
  try {
    await installLintPolicyForTest(join(repoRoot, "lint"));
    await stageLintPolicy(repoRoot, workspaceRoot);
    assert(await exists(join(workspaceRoot, "lint", "unslop", "manifest.json")));
    assert(await exists(join(workspaceRoot, "lint", "unslop", "unslop_engine.js")));

    const emptyRoot = await Deno.makeTempDir({ prefix: "lint-stage-empty-" });
    try {
      await assertRejects(
        () => stageLintPolicy(emptyRoot, workspaceRoot),
        Error,
        "lint policy manifest missing",
      );
    } finally {
      await Deno.remove(emptyRoot, { recursive: true });
    }
  } finally {
    await Deno.remove(repoRoot, { recursive: true }).catch(() => {});
    await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
  }
});

Deno.test("[scenario-schema] stageLintPolicy rejects a corrupt prebuilt policy", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "lint-corrupt-source-" });
  const workspaceRoot = await Deno.makeTempDir({ prefix: "lint-corrupt-workspace-" });
  try {
    await installLintPolicyForTest(join(repoRoot, "lint"));
    // Same length, different bytes: only the checksum can catch this.
    const enginePath = join(repoRoot, "lint", "unslop", "unslop_engine.js");
    const engineBytes = await Deno.readFile(enginePath);
    engineBytes[0] = (engineBytes[0] ?? 0) ^ 0xff;
    await Deno.writeFile(enginePath, engineBytes);
    await assertRejects(
      () => stageLintPolicy(repoRoot, workspaceRoot),
      Error,
      "checksum mismatch",
    );
    // Nothing was staged: a rejected source never leaves a partial destination behind.
    assertEquals(await exists(join(workspaceRoot, "lint", "unslop")), false);
  } finally {
    await Deno.remove(repoRoot, { recursive: true }).catch(() => {});
    await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
  }
});
