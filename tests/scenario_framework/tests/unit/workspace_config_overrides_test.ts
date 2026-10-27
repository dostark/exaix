/**
 * @module WorkspaceConfigOverridesTest
 * @path tests/scenario_framework/tests/unit/workspace_config_overrides_test.ts
 * @description Unit tests for scenario `workspace_config` overrides, which patch
 * the sandbox `exa.config.toml` so one scenario can set a config value without
 * changing the shared framework config.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { join } from "@std/path";
import { WorkspaceConfigOverridesSchema } from "../../schema/scenario_schema.ts";
import {
  applyStepConfigOverrides,
  applyWorkspaceConfigOverrides,
  STEP_CONFIG_OVERRIDES_ENV,
} from "../../runner/synthetic_runner.ts";
import { patchWorkspaceConfig, renderTomlValue, splitConfigPath } from "../../runner/workspace_config_overrides.ts";
import { readConfigFixture, withTempDir } from "@exaix/testing";

const BASE = await Deno.readTextFile(
  new URL("../../fixtures/configs/workspace-config-overrides-base.toml", import.meta.url),
);

Deno.test("[workspace_config] splitConfigPath handles bare and quoted segments", () => {
  assertEquals(splitConfigPath("portal_knowledge.default_mode"), ["portal_knowledge", "default_mode"]);
  assertEquals(splitConfigPath('models."mock:test".provider'), ["models", "mock:test", "provider"]);
  assertEquals(splitConfigPath("system"), ["system"]);
});

Deno.test("[workspace_config] renderTomlValue renders every permitted type", () => {
  assertEquals(renderTomlValue("standard"), '"standard"');
  assertEquals(renderTomlValue(true), "true");
  assertEquals(renderTomlValue(false), "false");
  assertEquals(renderTomlValue(12), "12");
  assertEquals(renderTomlValue(["a", "b"]), '["a", "b"]');
});

Deno.test("[workspace_config] replaces an existing key in place and keeps comments", () => {
  const patched = patchWorkspaceConfig(BASE, {
    "portal_knowledge.enable_symbol_level_dependency_graph": true,
  });

  assert(patched.includes("# Framework template"), "the leading comment must survive");
  const parsed = parse(patched) as {
    portal_knowledge: { enable_symbol_level_dependency_graph: boolean; default_mode: string };
  };
  assertEquals(parsed.portal_knowledge.enable_symbol_level_dependency_graph, true);
  assertEquals(parsed.portal_knowledge.default_mode, "standard", "untouched keys must stay");
});

Deno.test("[workspace_config] overrides an existing key value", () => {
  const patched = patchWorkspaceConfig(BASE, { "portal_knowledge.default_mode": "deep" });
  const parsed = parse(patched) as { portal_knowledge: { default_mode: string; quick_scan_limit: number } };

  assertEquals(parsed.portal_knowledge.default_mode, "deep");
  assertEquals(parsed.portal_knowledge.quick_scan_limit, 10000);
});

Deno.test("[workspace_config] appends a key to an existing table", () => {
  const patched = patchWorkspaceConfig(BASE, { "system.version": "9.9.9" });
  const parsed = parse(patched) as { system: { version: string; root: string } };

  assertEquals(parsed.system.version, "9.9.9");
  assertEquals(parsed.system.root, ".");
});

Deno.test("[workspace_config] appends a whole table when the section is absent", () => {
  const patched = patchWorkspaceConfig(BASE, { "portal_knowledge.memory.enabled": true });
  const parsed = parse(patched) as { portal_knowledge: { memory: { enabled: boolean }; default_mode: string } };

  assertEquals(parsed.portal_knowledge.memory.enabled, true);
  assertEquals(parsed.portal_knowledge.default_mode, "standard");
});

Deno.test("[workspace_config] patches several keys across tables in one call", () => {
  const patched = patchWorkspaceConfig(BASE, {
    "portal_knowledge.enable_symbol_level_dependency_graph": true,
    "portal_knowledge.default_mode": "deep",
    "system.log_level": "debug",
  });
  const parsed = parse(patched) as {
    portal_knowledge: { enable_symbol_level_dependency_graph: boolean; default_mode: string };
    system: { log_level: string };
  };

  assertEquals(parsed.portal_knowledge.enable_symbol_level_dependency_graph, true);
  assertEquals(parsed.portal_knowledge.default_mode, "deep");
  assertEquals(parsed.system.log_level, "debug");
});

Deno.test("[workspace_config] the result stays parseable when the input already ends with a newline", () => {
  const patched = patchWorkspaceConfig(BASE, { "system.log_level": "warn" });
  const parsed = parse(patched) as { system: { log_level: string } };
  assertEquals(parsed.system.log_level, "warn");
});

Deno.test("[workspace_config] applyWorkspaceConfigOverrides patches the sandbox config", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "exa.config.toml");
    await Deno.writeTextFile(configPath, BASE);

    await applyWorkspaceConfigOverrides(dir, {
      "portal_knowledge.enable_symbol_level_dependency_graph": true,
    });

    const parsed = parse(await Deno.readTextFile(configPath)) as {
      portal_knowledge: { enable_symbol_level_dependency_graph: boolean };
    };
    assertEquals(parsed.portal_knowledge.enable_symbol_level_dependency_graph, true);
  }, { prefix: "ws-cfg-" });
});

Deno.test("[workspace_config] applyWorkspaceConfigOverrides patches an operator-supplied config too", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "exa.config.toml");
    await Deno.writeTextFile(configPath, readConfigFixture("workspace-config-operator"));

    await applyWorkspaceConfigOverrides(dir, { "system.log_level": "debug" });

    const parsed = parse(await Deno.readTextFile(configPath)) as { system: { log_level: string; root: string } };
    assertEquals(parsed.system.log_level, "debug");
    assert((await Deno.readTextFile(configPath)).includes("# operator config"));
  }, { prefix: "ws-cfg-existing-" });
});

Deno.test("[workspace_config] applyWorkspaceConfigOverrides is a no-op with no overrides or no config", async () => {
  await withTempDir(async (dir) => {
    // No config file at all: must not throw and must not create one.
    await applyWorkspaceConfigOverrides(dir, { "system.log_level": "debug" });
    await applyWorkspaceConfigOverrides(dir, {});
    await applyWorkspaceConfigOverrides(dir, undefined);
    let created = false;
    try {
      await Deno.stat(join(dir, "exa.config.toml"));
      created = true;
    } catch { /* expected */ }
    assertEquals(created, false, "an absent config must stay absent");
  }, { prefix: "ws-cfg-noop-" });
});

Deno.test("[workspace_config] the scenario schema accepts and validates the override map", () => {
  const accepted = WorkspaceConfigOverridesSchema.safeParse({
    "portal_knowledge.enable_symbol_level_dependency_graph": true,
    'models."mock:test".provider': "mock",
    "portal_knowledge.quick_scan_limit": 500,
    "portal_knowledge.ignore_patterns": ["node_modules", ".git"],
  });
  assertEquals(accepted.success, true, JSON.stringify(accepted.error?.issues));

  const rejected = WorkspaceConfigOverridesSchema.safeParse({ "bad key with spaces": 1 });
  assertEquals(rejected.success, false);
});

Deno.test("[workspace_config] a step's escaped overrides apply to the sandbox config", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "exa.config.toml"), BASE);

    // Applied one step at a time, so the value can flip between steps.
    await applyStepConfigOverrides(dir, [
      { env: { [STEP_CONFIG_OVERRIDES_ENV]: '{"portal_knowledge.enable_symbol_level_dependency_graph": true}' } },
    ]);
    let parsed = parse(await Deno.readTextFile(join(dir, "exa.config.toml"))) as {
      portal_knowledge: { enable_symbol_level_dependency_graph: boolean; default_mode: string };
    };
    assertEquals(parsed.portal_knowledge.enable_symbol_level_dependency_graph, true);
    assertEquals(parsed.portal_knowledge.default_mode, "standard");

    await applyStepConfigOverrides(dir, [
      { env: { [STEP_CONFIG_OVERRIDES_ENV]: '{"portal_knowledge.enable_symbol_level_dependency_graph": false}' } },
    ]);
    parsed = parse(await Deno.readTextFile(join(dir, "exa.config.toml"))) as typeof parsed;
    assertEquals(parsed.portal_knowledge.enable_symbol_level_dependency_graph, false, "the flag must flip back off");

    // A step without the key leaves the config untouched.
    await applyStepConfigOverrides(dir, [{ env: {} }]);
    parsed = parse(await Deno.readTextFile(join(dir, "exa.config.toml"))) as typeof parsed;
    assertEquals(parsed.portal_knowledge.enable_symbol_level_dependency_graph, false);
  }, { prefix: "ws-step-cfg-" });
});

Deno.test("[workspace_config] a malformed step override fails loudly instead of silently skipping", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "exa.config.toml"), BASE);
    let threw = false;
    try {
      await applyStepConfigOverrides(dir, [
        { env: { [STEP_CONFIG_OVERRIDES_ENV]: "{not json" } },
      ]);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "a malformed override must not pass silently");
  }, { prefix: "ws-step-bad-" });
});
